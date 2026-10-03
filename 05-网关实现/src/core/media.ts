/**
 * 媒体本地化
 *  - 上游结果 URL 有有效期，生产环境建议落盘持久化
 *  - 对应 config.download_media / config.media_dir
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config";
import type { UpstreamClient } from "./upstream";

export interface PersistResult {
  /** 对外可访问的本地 URL */
  url: string;
  /** 本地文件绝对路径 */
  path: string;
  bytes: number;
  contentType: string;
}

/**
 * 将上游 URL 下载到本地 media_dir，返回本地访问路径。
 * 失败时由调用方决定回退到原始 URL（不抛错，返回 null）。
 */
export class MediaStore {
  private readonly dir: string;
  private readonly publicPrefix: string;
  /** 媒体 URL 签名密钥（源自 gateway_api_key）；为空则不签名（仅本机开发） */
  private readonly secret: string;

  constructor(private cfg: Config, private client: UpstreamClient) {
    this.dir = resolve(cfg._configDir, cfg.media_dir || "data/media");
    this.publicPrefix = "/media";
    this.secret = (cfg.gateway_api_key ?? "").trim();
  }

  /** 是否启用签名校验 */
  get signing(): boolean {
    return this.secret.length > 0;
  }

  get enabled(): boolean {
    return !!this.cfg.download_media;
  }

  get directory(): string {
    return this.dir;
  }

  /** 下载并落盘；返回本地 URL（失败返回 null，调用方回退原始 URL） */
  async persist(sourceUrl: string): Promise<PersistResult | null> {
    if (!this.enabled) return null;
    try {
      const { buffer, contentType } = await this.client.download(sourceUrl);
      mkdirSync(this.dir, { recursive: true });
      const name = this.fileName(sourceUrl, contentType);
      const full = resolve(this.dir, name);
      writeFileSync(full, Buffer.from(buffer));
      return { url: this.signedUrl(name), path: full, bytes: buffer.byteLength, contentType };
    } catch {
      return null;
    }
  }

  /** 构造媒体访问 URL（启用密钥时附带 HMAC 签名） */
  signedUrl(name: string): string {
    if (!this.signing) return `${this.publicPrefix}/${name}`;
    return `${this.publicPrefix}/${name}?sig=${this.sign(name)}`;
  }

  /** 计算文件名签名 */
  sign(name: string): string {
    return createHmac("sha256", this.secret).update(name).digest("hex").slice(0, 32);
  }

  /** 校验媒体访问签名；未启用签名时始终通过 */
  verify(name: string, sig: string | null): boolean {
    if (!this.signing) return true;
    if (!sig) return false;
    const expect = this.sign(name);
    const a = Buffer.from(expect);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** 批量落盘，失败项保留原始 URL */
  async persistMany(urls: string[]): Promise<string[]> {
    if (!this.enabled) return urls;
    const out: string[] = [];
    for (const u of urls) {
      const r = await this.persist(u);
      out.push(r?.url ?? u);
    }
    return out;
  }

  /** 读取本地媒体文件 */
  localPath(name: string): string | null {
    // 防路径穿越：仅允许文件名（无分隔符）
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
    const full = resolve(this.dir, name);
    if (!full.startsWith(this.dir)) return null;
    return existsSync(full) ? full : null;
  }

  private fileName(url: string, contentType: string): string {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    let ext = extname(new URL(url).pathname).replace(/[^a-z0-9.]/gi, "");
    if (!ext || ext.length > 6) ext = extFromMime(contentType);
    return `${Date.now()}-${id}${ext}`;
  }
}

function extFromMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  return map[m] ?? ".bin";
}
