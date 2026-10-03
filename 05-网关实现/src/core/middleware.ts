/**
 * 网关中间件
 *  - ConcurrencyGate：全局并发门控（对应 config.max_concurrent_requests）
 *  - SlidingWindowRateLimiter：滑动窗口限流（对应 config.rate_limit_*）
 *  - authenticateGateway：网关入口鉴权（config.gateway_api_key）
 *  - getClientIp：提取客户端 IP（限流分桶用）
 *
 * 设计：均无外部依赖，纯内存状态；核心逻辑与 HTTP 层解耦，可独立测试。
 */

import { createHash } from "node:crypto";
import type { Config } from "./config";

/* ---------------- 并发门控 ---------------- */

/** 全局并发闸门：超过 limit 的请求排队等待（FIFO） */
export class ConcurrencyGate {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** 获取一个执行槽位；limit<=0 表示不限制 */
  async acquire(): Promise<void> {
    if (this.limit <= 0) return;
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  /** 释放槽位并唤醒队首 */
  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  /** 在闸门保护下执行（自动释放，异常也释放） */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get stats(): { active: number; queued: number; limit: number } {
    return { active: this.active, queued: this.queue.length, limit: this.limit };
  }
}

/* ---------------- 速率限制 ---------------- */

export interface RateLimitResult {
  allowed: boolean;
  /** 剩余额度（-1 表示不限流） */
  remaining: number;
  /** 被拒时建议重试秒数 */
  retryAfterSec: number;
}

/**
 * 滑动窗口限流器
 * 每 key 维护窗口内的命中时间戳，超限则拒绝。
 * max<=0 或 windowMs<=0 表示禁用。
 */
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  /** 检查并记一次命中 */
  check(key: string, now = Date.now()): RateLimitResult {
    if (this.max <= 0 || this.windowMs <= 0) {
      return { allowed: true, remaining: -1, retryAfterSec: 0 };
    }

    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (arr.length >= this.max) {
      const oldest = arr[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, arr); // 保存裁剪后的结果
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    arr.push(now);
    this.hits.set(key, arr);
    return { allowed: true, remaining: this.max - arr.length, retryAfterSec: 0 };
  }

  /** 清理过期桶（避免内存无限增长），可由定时器调用 */
  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(k);
      else this.hits.set(k, kept);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}

/* ---------------- 网关鉴权 ---------------- */

/** 从请求头提取客户端提供的 key（Bearer 或 x-api-key 或 api_key query） */
export function extractProvidedKey(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer.trim();
  const xk = req.headers.get("x-api-key");
  if (xk) return xk.trim();
  return "";
}

/** 常量时间比较：先对两侧哈希再比较，规避「长度不等早返回」的侧信道 */
export function safeEqual(a: string, b: string): boolean {
  // 先做固定长度 SHA-256（长度信息被吸收进摘要），再常量时间比较
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/**
 * 网关入口鉴权。
 *  - 未配置 gateway_api_key：放行（向后兼容），由调用方决定是否告警
 *  - 已配置：请求须携带匹配的 key，否则拒绝
 * @param exempt 明确放行的路径（如 /healthz）
 */
export function authenticateGateway(
  req: Request,
  cfg: Config,
  path: string
): { ok: true } | { ok: false; message: string } {
  const required = (cfg.gateway_api_key ?? "").trim();
  if (!required) return { ok: true };
  if (GW_AUTH_EXEMPT.has(path)) return { ok: true };

  const provided = extractProvidedKey(req);
  if (!provided) {
    return { ok: false, message: "缺少 API Key（请设置 Authorization: Bearer <key> 或 x-api-key）" };
  }
  if (!safeEqual(provided, required)) {
    return { ok: false, message: "API Key 无效" };
  }
  return { ok: true };
}

/** 始终公开的路径（无需鉴权） */
export const GW_AUTH_EXEMPT = new Set<string>(["/healthz"]);

/* ---------------- 客户端 IP ---------------- */

interface BunServerLike {
  requestIP?: (req: Request) => { address?: string } | null;
}

/**
 * 提取客户端 IP（用于限流分桶）。
 *  - 默认信任 Bun 的 socket 地址（不可伪造）。
 *  - 仅当 trustProxy=true 时采用 x-forwarded-for，且取**最后一跳**
 *    （由最靠近网关的可信代理追加，客户端无法伪造；左段可被客户端伪造，故不用）。
 *  - 都不可用时返回常量 "unknown"（退化为全局单桶，不放大风险）。
 */
export function getClientIp(req: Request, server?: BunServerLike, trustProxy = false): string {
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }

  try {
    const ip = server?.requestIP?.(req);
    if (ip?.address) return ip.address;
  } catch {
    /* 忽略 */
  }
  return "unknown";
}
