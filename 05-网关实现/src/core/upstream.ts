/**
 * 上游 HTTP 客户端
 *
 * 关键：必须用 bun 运行时（`bun run`）。
 * Node 原生 https / http2 因 TLS 指纹（JA3/JA4）被 Cloudflare 拦截，返回 403。
 * bun 内置的 TLS 栈指纹接近真实浏览器，实测可直接通过。
 *
 * 逆向依据：
 *  - 所有请求需带浏览器语义头（origin/referer/user-agent/sec-fetch-*）
 *  - 认证头为 `x-auth-token`（裸 token，非 Bearer）
 *  - 平台头：x-platform=web, x-version=999.0.0, x-language=<locale>
 */

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/** 上游返回的统一信封 */
export interface ApiEnvelope<T = any> {
  code: string | number;
  data?: T;
  msg?: string;
  errorCode?: string | null;
  fieldErrors?: Array<{ field?: string; message?: string }>;
}

export class UpstreamError extends Error {
  code: string | number;
  httpStatus: number;
  envelope?: ApiEnvelope;
  constructor(message: string, code: string | number = "UNKNOWN", httpStatus = 0, envelope?: ApiEnvelope) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.envelope = envelope;
  }
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: any;
  token?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 是否走 multipart（上传文件时） */
  formData?: FormData;
  /** 原始响应（下载媒体时用） */
  raw?: boolean;
  signal?: AbortSignal;
}

export interface UpstreamClientOptions {
  baseUrl: string;
  timeoutSec?: number;
  defaultHeaders?: Record<string, string>;
}

export class UpstreamClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private extraHeaders: Record<string, string>;

  constructor(opts: UpstreamClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = (opts.timeoutSec ?? 180) * 1000;
    this.extraHeaders = opts.defaultHeaders ?? {};
  }

  /** 构造标准浏览器语义头 */
  private buildHeaders(token?: string, extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "user-agent": DESKTOP_UA,
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8",
      origin: this.baseUrl,
      referer: this.baseUrl + "/",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-platform": "web",
      "x-version": "999.0.0",
      "x-language": "en",
      ...this.extraHeaders,
    };
    // 认证：裸 token 放 x-auth-token（非 Bearer）
    if (token) h["x-auth-token"] = token;
    return { ...h, ...(extra ?? {}) };
  }

  /**
   * 发送请求并解析统一信封
   */
  async request<T = any>(opts: RequestOptions): Promise<ApiEnvelope<T>> {
    const { method = "GET", path, body, token, headers, timeoutMs, formData, raw, signal } = opts;
    const url = this.baseUrl + (path.startsWith("/") ? path : "/" + path);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    try {
      const h = this.buildHeaders(token, headers);
      let payload: BodyInit | undefined;
      if (formData) {
        payload = formData; // 不设 content-type，交给运行时加 boundary
        delete h["content-type"];
      } else if (body !== undefined) {
        h["content-type"] = "application/json";
        payload = JSON.stringify(body);
      }

      const res = await fetch(url, { method, headers: h, body: payload, signal: controller.signal });

      if (raw) return { code: String(res.status), data: res as any };

      const text = await res.text();

      // Cloudflare 拦截检测（返回 HTML 而非 JSON）
      if (text.trimStart().startsWith("<")) {
        const title = text.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
        throw new UpstreamError(
          `被 Cloudflare 拦截 (HTTP ${res.status})${title ? " — " + title : ""}。` +
            `请确认使用 bun 运行（node 会因 TLS 指纹被拦）。`,
          "CLOUDFLARE_BLOCKED",
          res.status
        );
      }

      let envelope: ApiEnvelope<T>;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new UpstreamError(`响应非 JSON (HTTP ${res.status}): ${text.slice(0, 120)}`, "BAD_RESPONSE", res.status);
      }

      return envelope;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 请求并断言成功（code === "200"），失败抛 UpstreamError
   */
  async requestOk<T = any>(opts: RequestOptions): Promise<T> {
    const env = await this.request<T>(opts);
    if (String(env.code) !== "200") {
      const msg = env.msg || env.fieldErrors?.[0]?.message || "上游返回错误";
      throw new UpstreamError(msg, env.code, 0, env);
    }
    return env.data as T;
  }

  /** GET */
  get<T = any>(path: string, token?: string, opts: Partial<RequestOptions> = {}) {
    return this.request<T>({ ...opts, method: "GET", path, token });
  }
  /** GET + 断言成功 */
  getOk<T = any>(path: string, token?: string, opts: Partial<RequestOptions> = {}) {
    return this.requestOk<T>({ ...opts, method: "GET", path, token });
  }
  /** POST */
  post<T = any>(path: string, body?: any, token?: string, opts: Partial<RequestOptions> = {}) {
    return this.request<T>({ ...opts, method: "POST", path, body, token });
  }
  /** POST + 断言成功 */
  postOk<T = any>(path: string, body?: any, token?: string, opts: Partial<RequestOptions> = {}) {
    return this.requestOk<T>({ ...opts, method: "POST", path, body, token });
  }
  /** DELETE */
  del<T = any>(path: string, body?: any, token?: string, opts: Partial<RequestOptions> = {}) {
    return this.request<T>({ ...opts, method: "DELETE", path, body, token });
  }

  /** 下载二进制（媒体文件） */
  async download(url: string, timeoutMs = 300_000): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    const full = url.startsWith("http") ? url : this.baseUrl + url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(full, {
        headers: { "user-agent": DESKTOP_UA, accept: "*/*", referer: this.baseUrl + "/" },
        signal: controller.signal,
      });
      if (!res.ok) throw new UpstreamError(`下载失败 HTTP ${res.status}`, String(res.status), res.status);
      return {
        buffer: await res.arrayBuffer(),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
