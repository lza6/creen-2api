/**
 * 认证服务
 *  - 邮箱密码登录
 *  - 注册（含邮箱验证码，对接可插拔的邮箱 API）
 *  - token 续期
 *
 * 上游协议（见 02-源码分析文档/04）：
 *  - POST /api/auth/login          { authLoginRequest: { email, password, turnstileToken } }
 *  - POST /api/auth/regSubmit      { authRegSubmitRequest: { email, password, confirmPassword, turnstileToken } }
 *  - POST /api/auth/confirmReg     { authConfirmRegRequest: { email, code } }
 *  - POST /api/auth/setNickname    { nickname }
 *  - GET  /api/auth/getAccount
 *
 * 注意：游客登录（loginByGuest）服务端已失效（idToken 恒 null），必须走注册/登录。
 */

import type { UpstreamClient } from "./upstream";
import { UpstreamError } from "./upstream";
import type { Config, EmailConfig } from "./config";

export interface LoginResult {
  token: string;
  email?: string;
  integral?: number;
}

export interface RegisterResult {
  token: string;
  email: string;
  password: string;
  nickname?: string;
}

/**
 * 邮箱 API 抽象层
 *  - 预留可插拔接口，后续接入具体邮箱服务（临时邮箱/自建域名邮箱）
 *  - 实现类需提供：分配地址 → 等待验证码
 */
export interface EmailProvider {
  /** 分配一个可用邮箱地址 */
  allocate(): Promise<{ address: string; id?: string }>;
  /** 等待并提取验证码（正则默认 6 位数字） */
  waitForCode(address: string, opts?: { timeoutMs?: number; since?: number }): Promise<string>;
}

/** 未配置邮箱 API 时的占位实现 */
export class NoopEmailProvider implements EmailProvider {
  async allocate(): Promise<{ address: string; id?: string }> {
    throw new UpstreamError(
      "未配置邮箱 API（config.email_config）。请在配置中填入邮箱服务商信息后启用自动注册。",
      "NO_EMAIL_PROVIDER",
      0
    );
  }
  async waitForCode(): Promise<string> {
    throw new UpstreamError("未配置邮箱 API", "NO_EMAIL_PROVIDER", 0);
  }
}

/**
 * 通用 HTTP 邮箱提供者
 * 适配常见"临时邮箱 API"形态（返回 JSON 列表），可通过 mapping 适配不同厂商。
 */
export class HttpEmailProvider implements EmailProvider {
  constructor(
    private cfg: EmailConfig,
    private mapping: {
      /** 分配地址：请求路径与解析函数 */
      allocatePath: string;
      allocateMethod?: string;
      allocateBody?: any;
      parseAddress: (json: any) => string;
      parseId?: (json: any) => string;
      /** 拉取收件箱：请求路径模板（{address}/{id} 会被替换）与验证码提取 */
      inboxPath: string;
      parseMessages: (json: any) => Array<{ text: string; ts?: number }>;
    }
  ) {}

  async allocate() {
    const url = this.cfg.api_base.replace(/\/+$/, "") + this.mapping.allocatePath;
    const res = await fetch(url, {
      method: this.mapping.allocateMethod ?? "POST",
      headers: {
        "content-type": "application/json",
        ...(this.cfg.api_key ? { authorization: `Bearer ${this.cfg.api_key}` } : {}),
      },
      body: this.mapping.allocateBody ? JSON.stringify(this.mapping.allocateBody) : undefined,
    });
    if (!res.ok) throw new UpstreamError(`邮箱 API 分配失败 HTTP ${res.status}`, "EMAIL_API", res.status);
    const json = await res.json();
    const address = this.mapping.parseAddress(json);
    const id = this.mapping.parseId?.(json);
    if (!address) throw new UpstreamError("邮箱 API 未返回地址", "EMAIL_API", 0);
    return { address: this.cfg.domain ? address.replace(/@.*$/, "@" + this.cfg.domain) : address, id };
  }

  async waitForCode(address: string, opts: { timeoutMs?: number; since?: number } = {}) {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const since = opts.since ?? 0;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 3000));
      const url = this.cfg.api_base.replace(/\/+$/, "") + this.mapping.inboxPath.replace("{address}", encodeURIComponent(address));
      try {
        const res = await fetch(url, {
          headers: { ...(this.cfg.api_key ? { authorization: `Bearer ${this.cfg.api_key}` } : {}) },
        });
        if (!res.ok) continue;
        const json = await res.json();
        const msgs = this.mapping.parseMessages(json);
        for (const m of msgs) {
          if (m.ts && m.ts < since) continue;
          const code = m.text.match(/\b(\d{6})\b/)?.[1];
          if (code) return code;
        }
      } catch {
        /* 继续重试 */
      }
    }
    throw new UpstreamError(`等待验证码超时（${timeoutMs / 1000}s）`, "EMAIL_TIMEOUT", 0);
  }
}

export class AuthService {
  constructor(
    private client: UpstreamClient,
    private cfg: Config,
    private emailProvider: EmailProvider = new NoopEmailProvider()
  ) {}

  /** 邮箱密码登录 */
  async login(email: string, password: string): Promise<LoginResult> {
    const env = await this.client.request<any>({
      method: "POST",
      path: "/api/auth/login",
      body: { authLoginRequest: { email, password, turnstileToken: "" } },
      // 登录接口通常不需要旧 token
    });

    // 业务错误码
    if (String(env.code) !== "200") {
      const errMap: Record<string, string> = {
        login_fail_limit_exceeded: "登录失败次数超限，请稍后再试",
        account_status_invalid: "账号状态异常",
        account_email_error: "邮箱错误",
        account_password_error: "密码错误",
      };
      const ec = String(env.errorCode ?? "");
      throw new UpstreamError(errMap[ec] ?? env.msg ?? "登录失败", env.code, 0, env);
    }

    const token = String(env.data?.idToken ?? "");
    if (!token) throw new UpstreamError("登录成功但未返回 idToken", "NO_TOKEN", 0, env);

    let integral: number | undefined;
    try {
      const acc = await this.client.getOk<any>("/api/auth/getAccount", token);
      integral = Number(acc?.integral ?? 0);
    } catch {
      /* ignore */
    }
    return { token, email, integral };
  }

  /** 完整注册流程（需邮箱 API） */
  async register(opts: {
    email?: string;
    password?: string;
    /** Turnstile token（若站点强制，需人工/打码） */
    turnstileToken?: string;
  } = {}): Promise<RegisterResult> {
    const password = opts.password ?? genPassword();
    let email = opts.email;

    if (!email) {
      const alloc = await this.emailProvider.allocate();
      email = alloc.address;
    }

    const since = Date.now();

    // 1) 提交注册（触发验证码邮件）
    const regEnv = await this.client.request<any>({
      method: "POST",
      path: "/api/auth/regSubmit",
      body: {
        authRegSubmitRequest: {
          email,
          password,
          confirmPassword: password,
          turnstileToken: opts.turnstileToken ?? "",
        },
      },
    });
    if (String(regEnv.code) !== "200") {
      throw new UpstreamError(regEnv.msg ?? "注册提交失败", regEnv.code, 0, regEnv);
    }

    // 2) 等待验证码
    const code = await this.emailProvider.waitForCode(email, { since });

    // 3) 确认注册 → 拿到 token
    const confirmEnv = await this.client.request<any>({
      method: "POST",
      path: "/api/auth/confirmReg",
      body: { authConfirmRegRequest: { email, code } },
    });
    if (String(confirmEnv.code) !== "200") {
      throw new UpstreamError(confirmEnv.msg ?? "验证码校验失败", confirmEnv.code, 0, confirmEnv);
    }

    const token = String(confirmEnv.data?.idToken ?? "");
    if (!token) throw new UpstreamError("注册成功但未返回 idToken", "NO_TOKEN", 0, confirmEnv);

    // 4) 设置昵称（可选）
    let nickname: string | undefined;
    try {
      nickname = await this.suggestNickname();
      if (nickname) {
        await this.client.post("/api/auth/setNickname", { nickname }, token);
      }
    } catch {
      /* 昵称失败不影响注册 */
    }

    return { token, email, password, nickname };
  }

  /** 随机昵称（公开端点） */
  async suggestNickname(): Promise<string | undefined> {
    try {
      const data = await this.client.getOk<any>("/api/auth/randomNickname");
      if (typeof data === "string") return data;
      if (data?.nickname) return data.nickname;
    } catch {
      /* ignore */
    }
    const pool = ["Creener", "AI_Explorer", "Dream_Weaver", "Cyber_Companion", "Novel_Maker"];
    return pool[Math.floor(Math.random() * pool.length)] + "_" + Math.floor(100 + Math.random() * 900);
  }

  /** 校验 token 是否有效并返回积分 */
  async checkToken(token: string): Promise<{ valid: boolean; integral?: number; email?: string }> {
    try {
      const acc = await this.client.getOk<any>("/api/auth/getAccount", token);
      return { valid: true, integral: Number(acc?.integral ?? 0), email: acc?.email };
    } catch (e) {
      const ue = e as UpstreamError;
      if (String(ue.code) === "401" || /未登录/.test(ue.message)) return { valid: false };
      throw e;
    }
  }

  /** 续期：优先重新登录；失败则重新注册（需邮箱 API） */
  async renew(credential: { email: string; password: string }): Promise<LoginResult> {
    try {
      return await this.login(credential.email, credential.password);
    } catch (e) {
      console.warn(`[auth] 续期登录失败(${credential.email}): ${(e as Error).message}`);
      throw e;
    }
  }
}

/** 生成强随机密码（满足 8-20 位） */
export function genPassword(len = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  // 保证含大小写与数字
  return "Aa1" + s.slice(0, len - 3);
}
