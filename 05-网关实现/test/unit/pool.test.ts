/**
 * 账号池单元测试（无网络）—— 验证 cooldown_map 配置真实生效
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountPool } from "../../src/core/account-pool";
import { UpstreamClient, UpstreamError } from "../../src/core/upstream";
import type { Config } from "../../src/core/config";

// 隔离测试产物，避免污染仓库 data/ 目录
const TMP = mkdtempSync(join(tmpdir(), "creen-pool-"));
process.on("exit", () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeCfg(cooldownMap: string): Config {
  return {
    _configDir: TMP,
    tokens: ["tok-aaa"],
    accounts: [],
    per_token_concurrent: 2,
    cooldown_map: cooldownMap,
    _cooldowns: cooldownMap
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((x) => Number.isFinite(x)),
  } as unknown as Config;
}

const client = new UpstreamClient({ baseUrl: "https://example.invalid" });

describe("AccountPool 冷却档位（cooldown_map 生效）", () => {
  test("首次失败使用档位[1]，而非硬编码 15", () => {
    const pool = new AccountPool(makeCfg("0,7,7,7"), client);
    const t = pool.acquire()!;
    const before = Date.now();
    pool.release(t, false, new UpstreamError("boom", "SERVER", 500));
    const delta = (t.cooldownUntil ?? 0) - before;
    // 应为 7s 左右（档位自定义值），而非 15s
    expect(delta).toBeGreaterThanOrEqual(6900);
    expect(delta).toBeLessThan(7600);
  });

  test("连续失败按档位递增", () => {
    const pool = new AccountPool(makeCfg("0,5,50,500"), client);
    const t = pool.acquire()!;
    pool.release(t, false, new UpstreamError("boom", "SERVER", 500));
    const d1 = (t.cooldownUntil ?? 0) - Date.now();
    // 冷却中也要能再次释放来推进 failCount（直接调 release 模拟）
    t.status = "active";
    pool.release(t, false, new UpstreamError("boom", "SERVER", 500));
    const d2 = (t.cooldownUntil ?? 0) - Date.now();
    expect(d2).toBeGreaterThan(d1);
  });

  test("401 标记 invalid（不进入冷却）", () => {
    const pool = new AccountPool(makeCfg("0,15"), client);
    const t = pool.acquire()!;
    pool.release(t, false, new UpstreamError("未登录", "401", 401));
    expect(t.status).toBe("invalid");
  });

  test("积分不足(-1) 标记 exhausted", () => {
    const pool = new AccountPool(makeCfg("0,15"), client);
    const t = pool.acquire()!;
    pool.release(t, false, new UpstreamError("积分不足", "-1", 0));
    expect(t.status).toBe("exhausted");
    expect(t.integral).toBe(0);
  });

  test("成功后重置失败计数", () => {
    const pool = new AccountPool(makeCfg("0,15"), client);
    const t = pool.acquire()!;
    t.failCount = 5;
    pool.release(t, true);
    expect(t.failCount).toBe(0);
    expect(t.status).toBe("active");
  });
});
