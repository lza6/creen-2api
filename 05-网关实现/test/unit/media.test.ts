/**
 * 媒体本地化测试（无网络）—— 签名、路径穿越防护
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaStore } from "../../src/core/media";
import { UpstreamClient } from "../../src/core/upstream";
import type { Config } from "../../src/core/config";

const TMP = mkdtempSync(join(tmpdir(), "creen-media-"));
process.on("exit", () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const client = new UpstreamClient({ baseUrl: "https://example.invalid" });
const mk = (key: string) =>
  new MediaStore({ _configDir: TMP, media_dir: "data/media", download_media: true, gateway_api_key: key } as unknown as Config, client);

describe("MediaStore 签名", () => {
  test("配置密钥时启用签名，URL 带 sig", () => {
    const m = mk("secret-key");
    expect(m.signing).toBe(true);
    const u = m.signedUrl("abc.png");
    expect(u).toContain("/media/abc.png?sig=");
  });

  test("未配置密钥时不签名", () => {
    const m = mk("");
    expect(m.signing).toBe(false);
    expect(m.signedUrl("abc.png")).toBe("/media/abc.png");
    // 无签名模式下 verify 始终通过
    expect(m.verify("abc.png", null)).toBe(true);
  });

  test("正确签名通过、错误/缺失签名拒绝", () => {
    const m = mk("secret-key");
    const sig = m.sign("abc.png");
    expect(m.verify("abc.png", sig)).toBe(true);
    expect(m.verify("abc.png", "deadbeef")).toBe(false);
    expect(m.verify("abc.png", null)).toBe(false);
    // 换文件名则原签名失效
    expect(m.verify("other.png", sig)).toBe(false);
  });

  test("签名稳定且不泄露密钥", () => {
    const m = mk("secret-key");
    expect(m.sign("x.png")).toBe(m.sign("x.png"));
    expect(m.sign("x.png")).not.toContain("secret-key");
  });
});

describe("MediaStore 路径穿越防护", () => {
  test("拒绝含分隔符/上跳的文件名", () => {
    const m = mk("");
    expect(m.localPath("../config.json")).toBeNull();
    expect(m.localPath("..\\config.json")).toBeNull();
    expect(m.localPath("a/b.png")).toBeNull();
    expect(m.localPath("/etc/passwd")).toBeNull();
    expect(m.localPath("....//x")).toBeNull();
  });

  test("拒绝不存在的合法文件名（返回 null）", () => {
    const m = mk("");
    expect(m.localPath("nonexistent-file.png")).toBeNull();
  });
});
