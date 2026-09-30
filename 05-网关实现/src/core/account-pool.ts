/**
 * 账号池
 *  - 管理多个 cernel 账号 token
 *  - 轮换（round-robin + 冷却）+ 并发门控
 *  - 积分查询与择优选号
 *  - 自动续期（token 失效时重新登录/注册）
 *  - 持久化到 data/accounts.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Config } from "./config";
import { UpstreamClient, UpstreamError } from "./upstream";

export type TokenStatus = "active" | "cooldown" | "invalid" | "exhausted";

export interface PoolToken {
  /** x-auth-token 值 */
  token: string;
  /** 归属邮箱（若已知） */
  email?: string;
  /** 最近一次查询到的积分 */
  integral?: number;
  /** 状态 */
  status: TokenStatus;
  /** 冷却到期时间戳 */
  cooldownUntil?: number;
  /** 连续失败次数 */
  failCount: number;
  /** 当前在飞请求数 */
  inflight: number;
  /** 累计使用次数 */
  usedCount: number;
  /** 最近使用时间 */
  lastUsed?: number;
  /** 备注 */
  note?: string;
}

export interface AccountStoreFile {
  tokens: Array<Pick<PoolToken, "token" | "email" | "integral" | "note">>;
  updatedAt: string;
}

export class AccountPool {
  private cfg: Config;
  private client: UpstreamClient;
  private pool: PoolToken[] = [];
  private cursor = 0;
  private storePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cfg: Config, client: UpstreamClient) {
    this.cfg = cfg;
    this.client = client;
    this.storePath = resolve(cfg._configDir, "data", "accounts.json");
    this.load();
  }

  /** 从 config + 持久化文件 初始化池 */
  load() {
    const seen = new Set<string>();

    // 1) 配置文件里的 token
    for (const t of this.cfg.tokens) {
      const token = String(t).trim();
      if (token && !seen.has(token)) {
        seen.add(token);
        this.pool.push(this.makeToken(token));
      }
    }

    // 2) 持久化文件（自动注册/续期产生的）
    try {
      if (existsSync(this.storePath)) {
        const raw: AccountStoreFile = JSON.parse(readFileSync(this.storePath, "utf8"));
        for (const t of raw.tokens ?? []) {
          const token = String(t.token ?? "").trim();
          if (token && !seen.has(token)) {
            seen.add(token);
            const pt = this.makeToken(token);
            pt.email = t.email;
            pt.integral = t.integral;
            pt.note = t.note;
            this.pool.push(pt);
          }
        }
      }
    } catch (e) {
      console.warn(`[pool] 读取 ${this.storePath} 失败: ${(e as Error).message}`);
    }

    console.log(`[pool] 载入 ${this.pool.length} 个 token`);
  }

  private makeToken(token: string): PoolToken {
    return { token, status: "active", failCount: 0, inflight: 0, usedCount: 0 };
  }

  /** 持久化（防抖 1s） */
  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 1000);
  }

  save() {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      const data: AccountStoreFile = {
        tokens: this.pool.map((t) => ({ token: t.token, email: t.email, integral: t.integral, note: t.note })),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.warn(`[pool] 保存失败: ${(e as Error).message}`);
    }
  }

  /** 手动添加 token */
  add(token: string, email?: string, note?: string): PoolToken {
    const t = String(token).trim();
    const exist = this.pool.find((x) => x.token === t);
    if (exist) return exist;
    const pt = this.makeToken(t);
    pt.email = email;
    pt.note = note;
    this.pool.push(pt);
    this.scheduleSave();
    return pt;
  }

  remove(token: string): boolean {
    const i = this.pool.findIndex((x) => x.token === token);
    if (i < 0) return false;
    this.pool.splice(i, 1);
    this.scheduleSave();
    return true;
  }

  get size() {
    return this.pool.length;
  }

  /** 当前可用的 token（active 且未超并发） */
  private available(): PoolToken[] {
    const now = Date.now();
    return this.pool.filter((t) => {
      if (t.status === "invalid") return false;
      if (t.status === "cooldown" && t.cooldownUntil && now < t.cooldownUntil) return false;
      if (t.status === "cooldown" && t.cooldownUntil && now >= t.cooldownUntil) t.status = "active";
      if (t.inflight >= this.cfg.per_token_concurrent) return false;
      return true;
    });
  }

  /**
   * 取一个可用 token（round-robin）
   * @param minIntegral 需要的最低积分（自动择优选号）
   */
  acquire(minIntegral = 0): PoolToken | null {
    let list = this.available();
    if (list.length === 0) return null;

    // 若指定了积分门槛，过滤出积分充足的（integrals 未知时保守放行）
    if (minIntegral > 0) {
      const rich = list.filter((t) => t.integral === undefined || t.integral >= minIntegral);
      if (rich.length > 0) list = rich;
    }

    // 轮询：优先选积分多、使用少的
    list.sort((a, b) => {
      const ia = a.integral ?? -1;
      const ib = b.integral ?? -1;
      if (ia !== ib) return ib - ia;
      return (a.usedCount ?? 0) - (b.usedCount ?? 0);
    });

    const pick = list[this.cursor % list.length];
    this.cursor = (this.cursor + 1) % Math.max(1, list.length);
    pick.inflight++;
    pick.usedCount++;
    pick.lastUsed = Date.now();
    return pick;
  }

  /** 归还 token */
  release(t: PoolToken, ok: boolean, err?: unknown) {
    t.inflight = Math.max(0, t.inflight - 1);
    if (ok) {
      t.failCount = 0;
      t.status = "active";
      return;
    }
    // 失败：判断是否认证问题
    const e = err as UpstreamError | undefined;
    const isAuth = e instanceof UpstreamError && (String(e.code) === "401" || /未登录|unauthor/i.test(e.message));
    if (isAuth) {
      t.status = "invalid";
      console.warn(`[pool] token ${mask(t.token)} 失效（401），标记 invalid`);
      this.scheduleSave();
      return;
    }
    // 积分不足
    const isNoCredit = e instanceof UpstreamError && String(e.code) === "-1";
    if (isNoCredit) {
      t.integral = 0;
      t.status = "exhausted";
      console.warn(`[pool] token ${mask(t.token)} 积分耗尽`);
      return;
    }
    // 其它失败：冷却
    t.failCount++;
    const cd = Math.min(300, t.failCount * 15);
    t.status = "cooldown";
    t.cooldownUntil = Date.now() + cd * 1000;
    console.warn(`[pool] token ${mask(t.token)} 失败 ${t.failCount} 次，冷却 ${cd}s`);
  }

  /** 查询所有 token 的积分 */
  async refreshIntegrals(): Promise<void> {
    const results = await Promise.allSettled(
      this.pool.map(async (t) => {
        try {
          const data = await this.client.getOk<any>("/api/auth/getAccount", t.token);
          t.integral = Number(data?.integral ?? 0);
          if (t.email === undefined && data?.email) t.email = data.email;
          if (t.status === "invalid") t.status = "active";
        } catch (e) {
          const ue = e as UpstreamError;
          // 401 → token 失效；其它 → 暂时不判定
          if (String(ue.code) === "401" || /未登录/.test(ue.message)) {
            t.status = "invalid";
          }
        }
      })
    );
    void results;
    this.scheduleSave();
  }

  /** 池状态快照（供 UI） */
  snapshot() {
    return this.pool.map((t) => ({
      token: mask(t.token),
      email: t.email,
      integral: t.integral,
      status: t.status,
      failCount: t.failCount,
      inflight: t.inflight,
      usedCount: t.usedCount,
      cooldownUntil: t.cooldownUntil ? new Date(t.cooldownUntil).toISOString() : null,
      note: t.note,
    }));
  }

  /** 有效 token 数 */
  activeCount() {
    return this.pool.filter((t) => t.status === "active" || t.status === "exhausted").length;
  }
}

/** 脱敏显示 */
export function mask(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return token.slice(0, 4) + "…";
  return token.slice(0, 8) + "…" + token.slice(-4);
}
