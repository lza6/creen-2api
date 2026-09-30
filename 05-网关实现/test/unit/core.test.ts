/**
 * 单元测试
 * 运行：bun test test/unit
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mask } from "../../src/core/account-pool";
import { ModelCatalog, BUILTIN_MODELS } from "../../src/core/catalog";
import { UpstreamClient, UpstreamError } from "../../src/core/upstream";
import { businessError, extractResultUrls } from "../../src/core/generation";
import { genPassword } from "../../src/core/auth";
import { cooldownFor, type Config } from "../../src/core/config";

/* ---------------- 模型目录 ---------------- */

describe("ModelCatalog", () => {
  let catalog: ModelCatalog;
  const fakeClient = new UpstreamClient({ baseUrl: "https://example.invalid" });

  beforeEach(() => {
    catalog = new ModelCatalog(fakeClient);
  });

  test("内置快照已加载", () => {
    expect(catalog.count).toBeGreaterThan(50);
  });

  test("按名字解析（含 kebab-case）", () => {
    const m = catalog.resolve("nano-banana-pro");
    expect(m).not.toBeNull();
    expect(m!.name).toBe("nano-banana-pro");
    expect(m!.kind).toBe("image");
    expect(m!.integralFee).toBe(45);
  });

  test("按纯数字 ID 解析（优先图像）", () => {
    const m = catalog.resolve(1);
    expect(m).not.toBeNull();
    expect(m!.id).toBe(1);
    expect(m!.kind).toBe("image");
  });

  test("大小写/空格容错", () => {
    expect(catalog.resolve("Nano_Banana_Pro")).not.toBeNull();
    expect(catalog.resolve("  nano banana pro  ")).not.toBeNull();
  });

  test("未知模型返回 null", () => {
    expect(catalog.resolve("no-such-model-xyz")).toBeNull();
    expect(catalog.resolve("")).toBeNull();
    expect(catalog.resolve(undefined)).toBeNull();
  });

  test("按类型过滤", () => {
    const imgs = catalog.list("image");
    const vids = catalog.list("video");
    expect(imgs.length).toBeGreaterThan(0);
    expect(vids.length).toBeGreaterThan(0);
    expect(imgs.every((m) => m.kind === "image")).toBe(true);
    expect(vids.every((m) => m.kind === "video")).toBe(true);
  });

  test("视频模型全部 vipLevel=2", () => {
    const vids = catalog.list("video");
    expect(vids.every((m) => m.vipLevel === 2)).toBe(true);
  });

  test("内置模型 ID 唯一（同 kind 内）", () => {
    const seen = new Set<string>();
    for (const m of BUILTIN_MODELS) {
      const k = `${m.kind}:${m.id}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  test("积分价为正整数", () => {
    for (const m of BUILTIN_MODELS) {
      expect(m.integralFee).toBeGreaterThan(0);
    }
  });
});

/* ---------------- 错误映射 ---------------- */

describe("业务错误映射", () => {
  test("已知错误码", () => {
    expect(businessError(-1)).toContain("积分不足");
    expect(businessError(-2)).toContain("生成失败");
    expect(businessError(-3)).toContain("审核");
    expect(businessError(-4)).toContain("超限");
    expect(businessError(-5)).toContain("频繁");
    expect(businessError(-6)).toContain("音色");
  });

  test("未知码回退到上游消息", () => {
    expect(businessError(999, "自定义消息")).toBe("自定义消息");
    expect(businessError(999)).toContain("999");
  });
});

/* ---------------- 结果 URL 提取 ---------------- */

describe("extractResultUrls", () => {
  test("提取 resultImages 数组", () => {
    const urls = extractResultUrls({ resultImages: ["https://a.com/1.png", "https://a.com/2.png"] });
    expect(urls).toEqual(["https://a.com/1.png", "https://a.com/2.png"]);
  });

  test("提取单字段", () => {
    expect(extractResultUrls({ resultImage: "https://a.com/x.png" })).toContain("https://a.com/x.png");
    expect(extractResultUrls({ resultVideo: "https://a.com/v.mp4" })).toContain("https://a.com/v.mp4");
    expect(extractResultUrls({ previewImage: "https://a.com/p.jpg" })).toContain("https://a.com/p.jpg");
  });

  test("递归提取嵌套结构", () => {
    const urls = extractResultUrls({ data: { list: [{ url: "https://a.com/deep.png" }] } });
    expect(urls).toContain("https://a.com/deep.png");
  });

  test("去重", () => {
    const urls = extractResultUrls({ resultImage: "https://a.com/x.png", url: "https://a.com/x.png" });
    expect(urls.length).toBe(1);
  });

  test("忽略非 URL 值", () => {
    expect(extractResultUrls({ resultImage: "not-a-url" })).toEqual([]);
    expect(extractResultUrls({})).toEqual([]);
    expect(extractResultUrls(null)).toEqual([]);
  });
});

/* ---------------- 密码生成 ---------------- */

describe("genPassword", () => {
  test("长度符合站点要求（8-20）", () => {
    for (let i = 0; i < 20; i++) {
      const p = genPassword();
      expect(p.length).toBeGreaterThanOrEqual(8);
      expect(p.length).toBeLessThanOrEqual(20);
    }
  });

  test("包含大小写与数字", () => {
    for (let i = 0; i < 20; i++) {
      const p = genPassword();
      expect(/[A-Z]/.test(p)).toBe(true);
      expect(/[a-z]/.test(p)).toBe(true);
      expect(/\d/.test(p)).toBe(true);
    }
  });

  test("每次不同", () => {
    const set = new Set(Array.from({ length: 50 }, () => genPassword()));
    expect(set.size).toBe(50);
  });
});

/* ---------------- 冷却档位 ---------------- */

describe("cooldownFor", () => {
  const cfg = { cooldown_map: "0,15,60,120,300", _cooldowns: [0, 15, 60, 120, 300] } as unknown as Config;

  test("按失败次数递增", () => {
    expect(cooldownFor(cfg, 0)).toBe(0);
    expect(cooldownFor(cfg, 1)).toBe(15);
    expect(cooldownFor(cfg, 2)).toBe(60);
    expect(cooldownFor(cfg, 100)).toBe(300); // 不越界
  });
});

/* ---------------- Token 脱敏 ---------------- */

describe("mask", () => {
  test("长 token 脱敏", () => {
    const m = mask("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature");
    expect(m).toContain("…");
    expect(m.length).toBeLessThan(30);
  });
  test("短 token 处理", () => {
    expect(mask("abc")).toBe("abc…");
    expect(mask("")).toBe("");
  });
});

/* ---------------- 上游客户端 ---------------- */

describe("UpstreamClient", () => {
  test("URL 正确拼接（无尾斜杠）", () => {
    const c = new UpstreamClient({ baseUrl: "https://x.com///" });
    expect(c.baseUrl).toBe("https://x.com");
  });

  test("UpstreamError 携带 code 与 httpStatus", () => {
    const e = new UpstreamError("测试", "401", 401);
    expect(e.code).toBe("401");
    expect(e.httpStatus).toBe(401);
    expect(e).toBeInstanceOf(Error);
  });
});
