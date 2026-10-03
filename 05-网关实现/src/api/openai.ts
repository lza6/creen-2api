/**
 * OpenAI 兼容 API
 *
 *  - GET  /v1/models                    列出可用模型
 *  - POST /v1/images/generations        图像生成（返回 URL 或 b64_json）
 *  - POST /v1/chat/completions          兼容层：把"生图"包装为 chat（返回 markdown 图片）
 *  - POST /v1/videos/generations        视频生成（自定义扩展）
 */

import type { Config } from "../core/config";
import type { ModelCatalog, ModelInfo } from "../core/catalog";
import type { AccountPool } from "../core/account-pool";
import type { GenerationService, GenerateOptions } from "../core/generation";
import { UpstreamError, type UpstreamClient } from "../core/upstream";
import type { MediaStore } from "../core/media";

export interface ApiContext {
  cfg: Config;
  catalog: ModelCatalog;
  pool: AccountPool;
  gen: GenerationService;
  client: UpstreamClient;
  /** 媒体本地化（config.download_media 开启时落盘） */
  media?: MediaStore;
}

export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(message: string, type = "invalid_request_error", status = 400, code?: string): Response {
  return jsonResponse({ error: { message, type, code: code ?? null } }, status);
}

/* ---------------- /v1/models ---------------- */

export function handleModels(ctx: ApiContext): Response {
  const models = ctx.catalog.list().map((m) => ({
    id: m.name,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "creen",
    permission: [],
    // 扩展字段（客户端可忽略）
    _kind: m.kind,
    _upstream_id: m.id,
    _integral_fee: m.integralFee,
    _vip_level: m.vipLevel,
    _description: m.description,
  }));
  return jsonResponse({ object: "list", data: models });
}

/* ---------------- /v1/images/generations ---------------- */

interface ImageReq {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  response_format?: "url" | "b64_json";
  /** 扩展：参考图 URL */
  image?: string | string[];
  /** 扩展：宽高比 */
  aspect_ratio?: string;
}

export async function handleImageGenerations(req: Request, ctx: ApiContext): Promise<Response> {
  let body: ImageReq;
  try {
    body = (await req.json()) as ImageReq;
  } catch {
    return errorResponse("请求体不是合法 JSON");
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return errorResponse("缺少 prompt 参数");
  }

  const model = ctx.catalog.resolve(body.model) ?? ctx.catalog.resolve(ctx.cfg.default_model);
  if (!model) return errorResponse("未找到可用模型", "invalid_request_error", 400, "model_not_found");
  if (model.kind !== "image" && model.kind !== "comic") {
    return errorResponse(`模型 ${model.name} 不是图像模型（kind=${model.kind}）`, "invalid_request_error", 400);
  }

  const n = clampInt(body.n ?? 1, 1, 4);
  const imageUrls = normalizeImages(body.image);

  const opts: GenerateOptions = {
    model,
    prompt: body.prompt,
    imageUrls,
    n,
    resolution: parseSize(body.size)?.resolution,
    aspectRatio: body.aspect_ratio ?? parseSize(body.size)?.aspect,
    quality: body.quality,
  };

  try {
    const urls = (await runGeneration(opts, ctx)).map((u) => absolutize(u, req));
    const wantB64 = body.response_format === "b64_json";
    const data = wantB64
      ? await Promise.all(urls.map(async (u) => ({ b64_json: await fetchAsBase64(u, ctx) })))
      : urls.map((u) => ({ url: u, revised_prompt: body.prompt }));

    return jsonResponse({
      created: Math.floor(Date.now() / 1000),
      data,
      _model: model.name,
      _integral_fee: model.integralFee,
    });
  } catch (e) {
    return mapError(e);
  }
}

/* ---------------- /v1/videos/generations ---------------- */

interface VideoReq {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  /** 扩展：时长（秒） */
  duration?: number;
  /** 扩展：参考图 */
  image?: string | string[];
  /** 扩展：模式 t2v / frames / reference */
  mode?: string;
}

export async function handleVideoGenerations(req: Request, ctx: ApiContext): Promise<Response> {
  let body: VideoReq;
  try {
    body = (await req.json()) as VideoReq;
  } catch {
    return errorResponse("请求体不是合法 JSON");
  }
  if (!body.prompt) return errorResponse("缺少 prompt 参数");

  const model = ctx.catalog.resolve(body.model) ?? ctx.catalog.list("video")[0];
  if (!model) return errorResponse("没有可用的视频模型", "invalid_request_error", 400, "model_not_found");
  if (model.kind !== "video") {
    return errorResponse(`模型 ${model.name} 不是视频模型`, "invalid_request_error", 400);
  }

  const opts: GenerateOptions = {
    model,
    prompt: body.prompt,
    imageUrls: normalizeImages(body.image),
    n: clampInt(body.n ?? 1, 1, 2),
    resolution: parseSize(body.size)?.resolution,
    aspectRatio: body.aspect_ratio,
    duration: clampInt(body.duration ?? 5, 1, 30),
    mode: body.mode,
  };

  try {
    const urls = (await runGeneration(opts, ctx)).map((u) => absolutize(u, req));
    return jsonResponse({
      created: Math.floor(Date.now() / 1000),
      data: urls.map((u) => ({ url: u })),
      _model: model.name,
      _integral_fee: model.integralFee,
    });
  } catch (e) {
    return mapError(e);
  }
}

/* ---------------- /v1/chat/completions（兼容包装） ---------------- */

interface ChatReq {
  model?: string;
  messages: Array<{ role: string; content: any }>;
  stream?: boolean;
  n?: number;
  /** 扩展：走视频模型 */
  kind?: "image" | "video";
}

export async function handleChatCompletions(req: Request, ctx: ApiContext): Promise<Response> {
  let body: ChatReq;
  try {
    body = (await req.json()) as ChatReq;
  } catch {
    return errorResponse("请求体不是合法 JSON");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return errorResponse("缺少 messages 参数");
  }

  // 提取最后一条 user 消息的文本与图片
  const last = [...body.messages].reverse().find((m) => m.role === "user");
  const { text, images } = extractContent(last?.content);

  const kind = body.kind ?? "image";
  let model: ModelInfo | null;
  if (body.model) {
    model = ctx.catalog.resolve(body.model);
  } else {
    model = ctx.catalog.list(kind)[0] ?? null;
  }
  if (!model) return errorResponse("未找到可用模型", "invalid_request_error", 400, "model_not_found");

  const opts: GenerateOptions = {
    model,
    prompt: text || "a beautiful image",
    imageUrls: images,
    n: clampInt(body.n ?? 1, 1, 4),
  };

  try {
    const urls = (await runGeneration(opts, ctx)).map((u) => absolutize(u, req));
    const content = urls.map((u) => (kind === "video" ? `![video](${u})` : `![image](${u})`)).join("\n");
    const id = "chatcmpl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);

    if (body.stream) {
      // 简化流式：一次性返回内容后结束（客户端兼容）
      const chunk = (delta: any, finish: string | null) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model!.name,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      const sse =
        chunk({ role: "assistant", content: "" }, null) + chunk({ content }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
      return new Response(sse, {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      });
    }

    return jsonResponse({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model.name,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      _integral_fee: model.integralFee,
    });
  } catch (e) {
    return mapError(e);
  }
}

/* ---------------- 核心：带账号池的生成流程 ---------------- */

async function runGeneration(opts: GenerateOptions, ctx: ApiContext): Promise<string[]> {
  if (ctx.pool.size === 0) {
    throw new UpstreamError(
      "未配置任何账号 token。请在 config.json 的 tokens 填入，或运行 `npm run login` 获取。",
      "NO_ACCOUNT",
      0
    );
  }

  const maxAttempts = ctx.cfg.retry_enabled ? ctx.cfg.max_attempts : 1;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 预估积分，用于择优选号
    let need = 0;
    try {
      need = await ctx.gen.estimateIntegral(opts);
    } catch {
      need = opts.model.integralFee * (opts.n ?? 1);
    }

    const token = ctx.pool.acquire(need);
    if (!token) {
      throw new UpstreamError(
        `无可用账号（池大小 ${ctx.pool.size}）。可能全部冷却或积分不足。`,
        "NO_AVAILABLE_ACCOUNT",
        503
      );
    }

    try {
      const { resultId } = await ctx.gen.submit(opts, token.token);
      if (!resultId) throw new UpstreamError("上游未返回 resultId", "NO_RESULT_ID", 0);

      const status = await ctx.gen.poll(resultId, opts.model.kind, token.token);
      if (status.status === "failed") {
        throw new UpstreamError(status.errorMessage ?? "生成失败", "GENERATION_FAILED", 0, status.raw);
      }

      let urls = status.resultUrls ?? [];
      // 轮询结果无 URL → 查详情
      if (urls.length === 0) {
        const detail = await ctx.gen.fetchDetail(resultId, opts.model.kind, token.token);
        urls = extractUrls(detail);
      }
      if (urls.length === 0) throw new UpstreamError("生成成功但未找到结果 URL", "NO_RESULT_URL", 0);

      ctx.pool.release(token, true);
      // 扣减本地积分估算并立即持久化
      if (token.integral !== undefined) token.integral = Math.max(0, token.integral - need);
      ctx.pool.save();

      // 媒体本地化：上游 URL 有有效期，落盘后返回本地稳定 URL
      const finalUrls = ctx.media?.enabled ? await ctx.media.persistMany(urls) : urls;
      return finalUrls;
    } catch (e) {
      ctx.pool.release(token, false, e);
      lastErr = e;

      // 认证/参数类错误不重试
      const ue = e as UpstreamError;
      if (["401", "NO_TOKEN"].includes(String(ue.code))) break;
      if (!ctx.cfg.retry_enabled) break;

      const wait = Math.min(5, 1 + attempt);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  throw lastErr instanceof Error ? lastErr : new UpstreamError("生成失败", "UNKNOWN", 0);
}

function extractUrls(detail: any): string[] {
  if (!detail || typeof detail !== "object") return [];
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) out.push(v);
  };
  if (Array.isArray(detail?.resultImages)) detail.resultImages.forEach(push);
  push(detail?.resultImage);
  push(detail?.previewImage);
  push(detail?.resultVideo);
  const walk = (x: any, d: number) => {
    if (d > 4 || !x) return;
    if (Array.isArray(x)) return x.forEach((i) => walk(i, d + 1));
    if (typeof x === "object") {
      for (const k of ["url", "imageUrl", "videoUrl", "resultUrl"]) push(x[k]);
      Object.values(x).forEach((v) => walk(v, d + 1));
    }
  };
  walk(detail, 0);
  return [...new Set(out)];
}

async function fetchAsBase64(url: string, ctx: ApiContext): Promise<string> {
  try {
    const { buffer } = await ctx.client.download(url);
    return Buffer.from(buffer).toString("base64");
  } catch {
    return "";
  }
}

/* ---------------- 工具函数 ---------------- */

/** 把本地媒体相对路径补全为绝对 URL（OpenAI 客户端需要完整 URL） */
function absolutize(url: string, req: Request): string {
  if (/^https?:\/\//i.test(url)) return url;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}${url.startsWith("/") ? "" : "/"}${url}`;
}

function normalizeImages(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

/** 解析 size（如 "1024x1024" → 无直接映射，返回宽高比提示） */
function parseSize(size?: string): { resolution?: string; aspect?: string } | null {
  if (!size) return null;
  const m = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  const ratio = `${w / g}:${h / g}`;
  const known: Record<string, string[]> = {
    "1:1": ["1024x1024", "512x512"],
    "16:9": ["1792x1024", "1920x1080", "1280x720"],
    "9:16": ["1024x1792", "1080x1920", "720x1280"],
    "4:3": ["1024x768"],
    "3:4": ["768x1024"],
  };
  let aspect: string | undefined;
  for (const [k, arr] of Object.entries(known)) {
    if (arr.includes(size.toLowerCase().replace(/\s/g, ""))) {
      aspect = k;
      break;
    }
  }
  aspect = aspect ?? (["1:1", "16:9", "9:16", "4:3", "3:4"].includes(ratio) ? ratio : undefined);
  const maxSide = Math.max(w, h);
  const resolution = maxSide >= 1500 ? "2K" : maxSide >= 900 ? "1K" : "512";
  return { resolution, aspect };
}

function extractContent(content: any): { text: string; images: string[] } {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };
  let text = "";
  const images: string[] = [];
  for (const part of content) {
    if (typeof part === "string") text += part;
    else if (part?.type === "text") text += part.text ?? "";
    else if (part?.type === "image_url") {
      const u = part.image_url?.url ?? part.image_url;
      if (typeof u === "string") images.push(u);
    }
  }
  return { text: text.trim(), images };
}

function clampInt(v: any, min: number, max: number): number {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function mapError(e: unknown): Response {
  const ue = e as UpstreamError;
  const code = String(ue.code ?? "UNKNOWN");
  const statusMap: Record<string, number> = {
    "401": 401,
    "403": 403,
    NO_TOKEN: 401,
    NO_ACCOUNT: 503,
    NO_AVAILABLE_ACCOUNT: 503,
    CLOUDFLARE_BLOCKED: 502,
    "-1": 402,
    "-4": 429,
    "-5": 429,
  };
  const status = statusMap[code] ?? 500;
  const type =
    status === 401
      ? "authentication_error"
      : status === 402
        ? "insufficient_quota"
        : status === 429
          ? "rate_limit_error"
          : status >= 500
            ? "api_error"
            : "invalid_request_error";
  return errorResponse(ue.message ?? "未知错误", type, status, code);
}
