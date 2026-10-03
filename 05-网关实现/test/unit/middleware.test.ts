/**
 * 中间件单元测试（无网络）
 * 运行：bun test test/unit
 */

import { describe, test, expect } from "bun:test";
import {
  ConcurrencyGate,
  SlidingWindowRateLimiter,
  authenticateGateway,
  extractProvidedKey,
  safeEqual,
  getClientIp,
} from "../../src/core/middleware";
import { redactValue, redactString } from "../../src/core/log";
import type { Config } from "../../src/core/config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 并发门控 ---------------- */

describe("ConcurrencyGate", () => {
  test("limit<=0 时不限制", async () => {
    const gate = new ConcurrencyGate(0);
    let peak = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
        })
      )
    );
    expect(peak).toBe(20);
  });

  test("限制并发峰值不超过 limit", async () => {
    const gate = new ConcurrencyGate(3);
    let peak = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 15 }, () =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
        })
      )
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(gate.stats.active).toBe(0);
    expect(gate.stats.queued).toBe(0);
  });

  test("任务抛错也释放槽位", async () => {
    const gate = new ConcurrencyGate(1);
    await expect(gate.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(gate.stats.active).toBe(0);
    // 后续任务仍可执行
    expect(await gate.run(async () => 42)).toBe(42);
  });
});

/* ---------------- 速率限制 ---------------- */

describe("SlidingWindowRateLimiter", () => {
  test("禁用时始终放行", () => {
    const rl = new SlidingWindowRateLimiter(0, 1000);
    for (let i = 0; i < 100; i++) expect(rl.check("k").allowed).toBe(true);
  });

  test("窗口内超限被拒，并给出 retry-after", () => {
    const rl = new SlidingWindowRateLimiter(3, 1000);
    const t0 = 1_000_000;
    expect(rl.check("k", t0).allowed).toBe(true);
    expect(rl.check("k", t0 + 1).allowed).toBe(true);
    expect(rl.check("k", t0 + 2).allowed).toBe(true);
    const denied = rl.check("k", t0 + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  test("不同 key 独立计数", () => {
    const rl = new SlidingWindowRateLimiter(1, 1000);
    expect(rl.check("a", 100).allowed).toBe(true);
    expect(rl.check("b", 100).allowed).toBe(true);
    expect(rl.check("a", 101).allowed).toBe(false);
  });

  test("窗口滑过后恢复", () => {
    const rl = new SlidingWindowRateLimiter(2, 1000);
    expect(rl.check("k", 0).allowed).toBe(true);
    expect(rl.check("k", 100).allowed).toBe(true);
    expect(rl.check("k", 200).allowed).toBe(false);
    // 超过窗口
    expect(rl.check("k", 1100).allowed).toBe(true);
  });

  test("prune 清理过期桶", () => {
    const rl = new SlidingWindowRateLimiter(5, 1000);
    rl.check("a", 0);
    rl.check("b", 0);
    expect(rl.size).toBe(2);
    rl.prune(5000);
    expect(rl.size).toBe(0);
  });
});

/* ---------------- 网关鉴权 ---------------- */

describe("extractProvidedKey / safeEqual", () => {
  test("从 Bearer 提取", () => {
    const req = new Request("http://x/", { headers: { authorization: "Bearer sk-abc" } });
    expect(extractProvidedKey(req)).toBe("sk-abc");
  });
  test("从 x-api-key 提取", () => {
    const req = new Request("http://x/", { headers: { "x-api-key": "sk-xyz" } });
    expect(extractProvidedKey(req)).toBe("sk-xyz");
  });
  test("无 key 返回空", () => {
    expect(extractProvidedKey(new Request("http://x/"))).toBe("");
  });
  test("safeEqual 常量时间比较（含长度不同）", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
    // 长度不同不早返回（两条路径都经过哈希），行为正确
    expect(safeEqual("a".repeat(100), "a".repeat(100))).toBe(true);
  });
});

describe("authenticateGateway", () => {
  const base = { gateway_api_key: "" } as Config;

  test("未配置 key 时放行", () => {
    expect(authenticateGateway(new Request("http://x/v1/models"), base, "/v1/models").ok).toBe(true);
  });

  test("已配置 key：无 key 拒绝", () => {
    const cfg = { gateway_api_key: "secret" } as Config;
    const r = authenticateGateway(new Request("http://x/v1/models"), cfg, "/v1/models");
    expect(r.ok).toBe(false);
  });

  test("已配置 key：错误 key 拒绝", () => {
    const cfg = { gateway_api_key: "secret" } as Config;
    const req = new Request("http://x/v1/models", { headers: { "x-api-key": "wrong" } });
    expect(authenticateGateway(req, cfg, "/v1/models").ok).toBe(false);
  });

  test("已配置 key：正确 key 放行", () => {
    const cfg = { gateway_api_key: "secret" } as Config;
    const req = new Request("http://x/v1/models", { headers: { authorization: "Bearer secret" } });
    expect(authenticateGateway(req, cfg, "/v1/models").ok).toBe(true);
  });

  test("/healthz 免鉴权", () => {
    const cfg = { gateway_api_key: "secret" } as Config;
    expect(authenticateGateway(new Request("http://x/healthz"), cfg, "/healthz").ok).toBe(true);
  });
});

/* ---------------- 客户端 IP ---------------- */

describe("getClientIp", () => {
  test("默认不信任 XFF，使用 socket 地址", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const ip = getClientIp(req, { requestIP: () => ({ address: "10.0.0.5" }) });
    expect(ip).toBe("10.0.0.5");
  });

  test("默认不信任 XFF，socket 不可用时返回 unknown", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(getClientIp(req)).toBe("unknown");
  });

  test("trust_proxy=true 时取 XFF 最后一跳（最可信）", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req, undefined, true)).toBe("5.6.7.8");
  });

  test("trust_proxy=true 且无 XFF 时回退 x-real-ip", () => {
    const req = new Request("http://x/", { headers: { "x-real-ip": "7.7.7.7" } });
    expect(getClientIp(req, undefined, true)).toBe("7.7.7.7");
  });
});

/* ---------------- 日志脱敏 ---------------- */

describe("log redaction", () => {
  test("遮蔽敏感字段", () => {
    const out = redactValue({ token: "abcdef", email: "a@b.com", api_key: "xyz" }) as any;
    expect(out.token).toBe("***REDACTED***");
    expect(out.api_key).toBe("***REDACTED***");
    expect(out.email).toBe("a@b.com");
  });

  test("嵌套结构递归遮蔽", () => {
    const out = redactValue({ a: { password: "p", keep: 1 }, list: [{ secret: "s" }] }) as any;
    expect(out.a.password).toBe("***REDACTED***");
    expect(out.a.keep).toBe(1);
    expect(out.list[0].secret).toBe("***REDACTED***");
  });

  test("遮蔽字符串里的 JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturepart";
    expect(redactString(`token=${jwt}`)).toContain("***REDACTED***");
    expect(redactString(`token=${jwt}`)).not.toContain(jwt);
  });
});
