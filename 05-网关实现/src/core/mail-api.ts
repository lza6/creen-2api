/**
 * Cloud Mail 邮箱 API 客户端
 *
 * 对接 maillab/cloud-mail（本项目邮箱服务的开源实现）：
 *   - POST /api/login                  { email, password }        → 用户 JWT（可选）
 *   - POST /api/public/genToken        { email, password }        → 公钥 token（需管理员凭据）
 *   - POST /api/public/emailList       { toEmail, size, num }     → 邮件列表（需 Authorization: <公钥>）
 *   - GET  /api/setting/websiteConfig                             → 站点配置（含可用域名列表）
 *
 * 用途：作为「验证码读取器」，用于读取你自己邮箱收到的邮件（登录 / 找回密码 / 注册验证）。
 * 说明：catch-all 域名下任意 `前缀@域名` 均可收信，无需逐个注册邮箱账号。
 */

import type { Config } from "./config";

export interface MailMessage {
  emailId: number;
  toEmail: string;
  sendEmail: string;
  sendName: string;
  subject: string;
  /** 服务端已解析出的验证码（若识别到） */
  code?: string;
  text?: string;
  createTime: string;
}

export interface MailApiOptions {
  apiBase: string;
  adminEmail: string;
  adminPassword: string;
  /** 可接收邮件的域名（形如 "@example.com"）；留空则运行时从 websiteConfig 拉取 */
  domains?: string[];
}

export class MailApiError extends Error {
  constructor(message: string, readonly code?: string | number) {
    super(message);
    this.name = "MailApiError";
  }
}

export class CloudMailClient {
  private readonly base: string;
  private publicToken: string | null = null;
  private domainsCache: string[] | null = null;

  constructor(private opts: MailApiOptions) {
    this.base = opts.apiBase.replace(/\/+$/, "");
  }

  /** 从配置构造；未配置则返回 null */
  static fromConfig(cfg: Config): CloudMailClient | null {
    const m = (cfg as any).mail_api;
    if (!m?.enabled) return null;
    const apiBase = String(m.api_base ?? "").trim();
    const adminEmail = String(m.admin_email ?? "").trim();
    // 密码优先取环境变量，避免落盘
    const adminPassword = String(process.env.CREEN_MAIL_ADMIN_PASSWORD ?? m.admin_password ?? "").trim();
    if (!apiBase || !adminEmail || !adminPassword) return null;
    return new CloudMailClient({
      apiBase,
      adminEmail,
      adminPassword,
      domains: Array.isArray(m.domains) ? m.domains : undefined,
    });
  }

  private async post(path: string, body: unknown, bearer?: string): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (bearer) headers["authorization"] = bearer;
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new MailApiError(`邮箱 API 请求失败: ${(e as Error).message}`);
    }
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new MailApiError(`邮箱 API 返回非 JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }
    if (Number(json.code) !== 200) {
      throw new MailApiError(json.message ?? `邮箱 API 错误 (code=${json.code})`, json.code);
    }
    return json.data;
  }

  /** 获取公钥 token（每次调用会刷新，旧 token 失效） */
  async getPublicToken(force = false): Promise<string> {
    if (this.publicToken && !force) return this.publicToken;
    const data = await this.post("/api/public/genToken", {
      email: this.opts.adminEmail,
      password: this.opts.adminPassword,
    });
    const token = String(data?.token ?? "");
    if (!token) throw new MailApiError("邮箱 API 未返回公钥 token");
    this.publicToken = token;
    return token;
  }

  /** 拉取可接收邮件的域名列表（形如 "@example.com"） */
  async getDomains(): Promise<string[]> {
    if (this.opts.domains?.length) return this.opts.domains;
    if (this.domainsCache) return this.domainsCache;
    const res = await fetch(this.base + "/api/setting/websiteConfig", {
      signal: AbortSignal.timeout(20_000),
    });
    const json: any = await res.json();
    const list: string[] = json?.data?.domainList ?? [];
    if (list.length === 0) throw new MailApiError("邮箱 API 未返回可用域名（domainList 为空）");
    this.domainsCache = list;
    return list;
  }

  /** 生成一个 catch-all 邮箱地址（无需调用 API） */
  async allocateAddress(prefix?: string): Promise<string> {
    const domains = await this.getDomains();
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const name = prefix ?? `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    return `${name}${domain}`;
  }

  /** 查询指定收件地址的邮件（按时间倒序） */
  async listEmails(toEmail: string, size = 20, num = 1): Promise<MailMessage[]> {
    const token = await this.getPublicToken();
    const data = await this.post("/api/public/emailList", { toEmail, size, num }, token);
    return Array.isArray(data) ? (data as MailMessage[]) : [];
  }

  /** 当前收件箱里最大的 emailId（用于只关注新邮件） */
  async maxEmailId(toEmail: string): Promise<number> {
    const list = await this.listEmails(toEmail, 1, 1);
    return list.reduce((mx, m) => Math.max(mx, m.emailId ?? 0), 0);
  }

  /**
   * 等待并提取验证码。
   *  - 优先使用服务端已解析的 `code` 字段
   *  - 否则从 subject/text 中用正则提取 6 位数字
   *  - 推荐用 sinceEmailId（只关注新邮件，避免时区误差）；since 为时间戳兜底
   */
  async waitForCode(
    address: string,
    opts: { timeoutMs?: number; intervalMs?: number; since?: number; sinceEmailId?: number } = {}
  ): Promise<{ code: string; message: MailMessage }> {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const intervalMs = opts.intervalMs ?? 3000;
    const since = opts.since ?? 0;
    const sinceEmailId = opts.sinceEmailId;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      let list: MailMessage[] = [];
      try {
        list = await this.listEmails(address, 10, 1);
      } catch (e) {
        // 公钥可能被刷新导致失效 → 刷新一次再试
        if (e instanceof MailApiError && /token/i.test(e.message)) {
          await this.getPublicToken(true);
        }
        await sleep(intervalMs);
        continue;
      }

      for (const m of list) {
        if (sinceEmailId !== undefined && (m.emailId ?? 0) <= sinceEmailId) continue;
        if (sinceEmailId === undefined && since) {
          const ts = toTs(m.createTime);
          if (ts && ts < since) continue;
        }
        const code = m.code && /^\d{4,8}$/.test(m.code) ? m.code : extractCode(m.subject, m.text);
        if (code) return { code, message: m };
      }
      await sleep(intervalMs);
    }
    throw new MailApiError(`等待验证码超时（${Math.round(timeoutMs / 1000)}s）`);
  }
}

/** 从邮件主题/正文提取验证码 */
export function extractCode(subject = "", text = ""): string | null {
  const combined = `${subject}\n${text}`;
  // 优先「code/验证码」附近的数字
  const near = combined.match(/(?:code|verification|验证码|otp)[^\d]{0,20}(\d{4,8})/i);
  if (near) return near[1];
  const any = combined.match(/\b(\d{6})\b/);
  return any ? any[1] : null;
}

function toTs(s?: string): number {
  if (!s) return 0;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? t : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
