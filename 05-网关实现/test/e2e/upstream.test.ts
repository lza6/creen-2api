/**
 * E2E 测试 —— 真实调用上游（只测公开端点，不需要 token）
 * 运行：bun test test/e2e
 *
 * 需要网络。若被 Cloudflare 拦截（非 bun 运行时）会失败——这是预期保护。
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { UpstreamClient } from "../../src/core/upstream";
import { ModelCatalog } from "../../src/core/catalog";
import { GenerationService } from "../../src/core/generation";
import { loadConfig } from "../../src/core/config";

const UPSTREAM = "https://www.creen.ai";
const client = new UpstreamClient({ baseUrl: UPSTREAM, timeoutSec: 40 });

describe("E2E: 上游连通性", () => {
  test("运行时必须是 bun（否则被 Cloudflare 拦截）", () => {
    expect(typeof (globalThis as any).Bun).not.toBe("undefined");
  });

  test("GET /api/aiImage/models 返回图像模型", async () => {
    const data = await client.getOk<any>("/api/aiImage/models");
    const n = Array.isArray(data) ? data.length : Object.keys(data ?? {}).length;
    expect(n).toBeGreaterThan(0);
    console.log(`      → 图像模型 ${n} 个`);
  });

  test("GET /api/aiVideo/models 返回视频模型", async () => {
    const data = await client.getOk<any>("/api/aiVideo/models");
    const n = Array.isArray(data) ? data.length : Object.keys(data ?? {}).length;
    expect(n).toBeGreaterThan(0);
    console.log(`      → 视频模型 ${n} 个`);
  });

  test("GET /api/aiComic/styles 返回漫画风格", async () => {
    const data = await client.getOk<any>("/api/aiComic/styles");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    // 结构校验
    expect(data[0]).toHaveProperty("code");
    console.log(`      → 漫画风格 ${data.length} 种`);
  });

  test("GET /api/aiComic/formats 返回漫画格式", async () => {
    const data = await client.getOk<any>("/api/aiComic/formats");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    console.log(`      → 漫画格式 ${data.length} 种`);
  });

  test("GET /api/home/banners 返回 banner", async () => {
    const data = await client.getOk<any>("/api/home/banners");
    expect(Array.isArray(data) || typeof data === "object").toBe(true);
  });
});

describe("E2E: 积分计算（公开端点）", () => {
  test("图像积分计算返回数值", async () => {
    const fee = await client.postOk<number>("/api/aiImage/calculateIntegral", {
      modelId: 1,
      number: 1,
      hasInputImage: false,
    });
    expect(typeof fee).toBe("number");
    expect(fee).toBeGreaterThanOrEqual(0);
    console.log(`      → modelId=1 需 ${fee} 积分`);
  });

  test("不同模型积分不同", async () => {
    const fee = async (id: number) =>
      client.postOk<number>("/api/aiImage/calculateIntegral", { modelId: id, number: 1, hasInputImage: false });
    const cheap = await fee(1);
    const expensive = await fee(6); // nano-banana-pro
    expect(expensive).toBeGreaterThan(cheap);
    console.log(`      → 模型1=${cheap}, 模型6=${expensive}`);
  });

  test("数量影响积分", async () => {
    const one = await client.postOk<number>("/api/aiImage/calculateIntegral", {
      modelId: 1,
      number: 1,
      hasInputImage: false,
    });
    const four = await client.postOk<number>("/api/aiImage/calculateIntegral", {
      modelId: 1,
      number: 4,
      hasInputImage: false,
    });
    expect(four).toBeGreaterThanOrEqual(one);
    console.log(`      → 1张=${one}, 4张=${four}`);
  });
});

describe("E2E: 认证要求（无 token）", () => {
  test("生成端点未登录返回 401", async () => {
    const env = await client.post("/api/aiImage/create/v2", { modelId: 1, prompt: "test", number: 1, permission: 1 });
    expect(String(env.code)).toBe("401");
    console.log(`      → ${env.msg}`);
  });

  test("getAccount 未登录返回 401", async () => {
    const env = await client.get("/api/auth/getAccount");
    expect(String(env.code)).toBe("401");
  });

  test("游客登录不返回 token（服务端已失效）", async () => {
    const g = await client.postOk<any>("/api/auth/createGuest", {}, undefined, { headers: { "cf-ipcountry": "US" } });
    expect(g.guestUid).toBeTruthy();
    const l = await client.post<any>("/api/auth/loginByGuest", {
      authLoginByGuestRequest: { guestUid: g.guestUid, guestKey: g.guestKey },
    });
    // 服务端已关闭游客登录：code=200 但 idToken=null
    expect(String(l.code)).toBe("200");
    expect(l.data?.idToken ?? null).toBeNull();
    console.log(`      → 游客登录 idToken=${l.data?.idToken}`);
  });
});

describe("E2E: 目录刷新", () => {
  test("从上游刷新目录并合并内置快照", async () => {
    const catalog = new ModelCatalog(client);
    const builtinCount = catalog.count;
    const r = await catalog.refresh();
    expect(r.ok).toBe(true);
    expect(catalog.count).toBeGreaterThanOrEqual(builtinCount);
    console.log(`      → 刷新后 ${catalog.count} 个模型（内置 ${builtinCount}）`);
    // 刷新后仍能解析
    expect(catalog.resolve("nano-banana-pro")).not.toBeNull();
  });
});
