/**
 * 模型目录
 *  - 从上游动态拉取（/api/aiImage/models、/api/aiVideo/models 等）
 *  - 内置实测快照兜底（来自 02-源码分析文档/29 与 03-抓取验证/_evidence）
 *  - 提供 OpenAI 兼容的 model id ↔ 上游数字 id 映射
 */

import type { UpstreamClient } from "./upstream";

export type ModelKind = "image" | "video" | "lipsync" | "motion" | "comic";

export interface ModelInfo {
  /** 上游数字 id（创建任务时用） */
  id: number;
  /** 用户可读名（OpenAI model 字段） */
  name: string;
  kind: ModelKind;
  /** 基础积分价 */
  integralFee: number;
  /** VIP 等级要求（0=免费） */
  vipLevel: number;
  description?: string;
  /** 可选参数（来自 upstream config） */
  options?: {
    resolutions?: string[];
    aspectRatios?: string[];
    durations?: number[];
    qualities?: string[];
    modes?: string[];
  };
}

/** 内置快照（实测于 2026-09-30，见 03-抓取验证/_evidence/models-summary.json） */
export const BUILTIN_MODELS: ModelInfo[] = [
  // ---------- 图像（20） ----------
  { id: 1, name: "creen-ai-2.0", kind: "image", integralFee: 1, vipLevel: 0, description: "Creen's first well-balanced image model" },
  { id: 3, name: "z-image-turbo", kind: "image", integralFee: 10, vipLevel: 0 },
  { id: 25, name: "gpt-image-2.5-sunburst", kind: "image", integralFee: 10, vipLevel: 0 },
  { id: 24, name: "gpt-image-2.5-flare", kind: "image", integralFee: 10, vipLevel: 0 },
  { id: 14, name: "gpt-image-2", kind: "image", integralFee: 10, vipLevel: 0 },
  { id: 22, name: "nano-banana-2-lite", kind: "image", integralFee: 20, vipLevel: 0 },
  { id: 7, name: "nano-banana-2", kind: "image", integralFee: 20, vipLevel: 0 },
  { id: 6, name: "nano-banana-pro", kind: "image", integralFee: 45, vipLevel: 0 },
  { id: 8, name: "nano-banana", kind: "image", integralFee: 20, vipLevel: 0 },
  { id: 21, name: "seedream-5.0-pro", kind: "image", integralFee: 20, vipLevel: 0 },
  { id: 10, name: "seedream-5.0-lite", kind: "image", integralFee: 15, vipLevel: 0 },
  { id: 4, name: "seedream-4.5", kind: "image", integralFee: 20, vipLevel: 0 },
  { id: 18, name: "seedream-4.0", kind: "image", integralFee: 15, vipLevel: 0 },
  { id: 19, name: "qwen-3.0-pro", kind: "image", integralFee: 15, vipLevel: 0 },
  { id: 20, name: "qwen-3.0", kind: "image", integralFee: 10, vipLevel: 0 },
  { id: 15, name: "qwen-image-2.0", kind: "image", integralFee: 10, vipLevel: 0 },
  { id: 16, name: "qwen-image-2.0-pro", kind: "image", integralFee: 15, vipLevel: 0 },
  { id: 17, name: "wanx-2.7", kind: "image", integralFee: 15, vipLevel: 0 },
  { id: 23, name: "wanx-2.7-pro", kind: "image", integralFee: 30, vipLevel: 0 },
  { id: 9, name: "grok-imagine", kind: "image", integralFee: 20, vipLevel: 0 },

  // ---------- 视频（37） ----------
  { id: 1, name: "creen-ai-2.0-video", kind: "video", integralFee: 50, vipLevel: 2 },
  { id: 27, name: "hailuo-2.3-fast", kind: "video", integralFee: 60, vipLevel: 2 },
  { id: 28, name: "hailuo-2.3", kind: "video", integralFee: 60, vipLevel: 2 },
  { id: 29, name: "hailuo-02", kind: "video", integralFee: 55, vipLevel: 2 },
  { id: 67, name: "minimax-h3", kind: "video", integralFee: 150, vipLevel: 2 },
  { id: 51, name: "wan-2.6", kind: "video", integralFee: 125, vipLevel: 2 },
  { id: 62, name: "wan-2.2-plus", kind: "video", integralFee: 40, vipLevel: 2 },
  { id: 61, name: "wan-2.2-flash", kind: "video", integralFee: 35, vipLevel: 2 },
  { id: 53, name: "wan-2.5", kind: "video", integralFee: 55, vipLevel: 2 },
  { id: 69, name: "wan-3.0", kind: "video", integralFee: 70, vipLevel: 2 },
  { id: 70, name: "wan-3.0-prime", kind: "video", integralFee: 100, vipLevel: 2 },
  { id: 50, name: "wan-2.7", kind: "video", integralFee: 200, vipLevel: 2 },
  { id: 45, name: "seedance-1.5-pro", kind: "video", integralFee: 55, vipLevel: 2 },
  { id: 46, name: "seedance-1.0-pro", kind: "video", integralFee: 55, vipLevel: 2 },
  { id: 47, name: "seedance-1.0-pro-fast", kind: "video", integralFee: 50, vipLevel: 2 },
  { id: 68, name: "seedance-2.5", kind: "video", integralFee: 210, vipLevel: 2 },
  { id: 63, name: "seedance-2.0-mini", kind: "video", integralFee: 70, vipLevel: 2 },
  { id: 43, name: "seedance-2.0", kind: "video", integralFee: 140, vipLevel: 2 },
  { id: 44, name: "seedance-2.0-fast", kind: "video", integralFee: 110, vipLevel: 2 },
  { id: 56, name: "vidu-q3", kind: "video", integralFee: 100, vipLevel: 2 },
  { id: 57, name: "vidu-q2", kind: "video", integralFee: 25, vipLevel: 2 },
  { id: 30, name: "kling-3.0-pro", kind: "video", integralFee: 85, vipLevel: 2 },
  { id: 31, name: "kling-2.6-pro", kind: "video", integralFee: 60, vipLevel: 2 },
  { id: 32, name: "kling-2.6", kind: "video", integralFee: 60, vipLevel: 2 },
  { id: 33, name: "kling-2.5-turbo", kind: "video", integralFee: 60, vipLevel: 2 },
  { id: 34, name: "kling-2.1-master", kind: "video", integralFee: 55, vipLevel: 2 },
  { id: 35, name: "kling-2.1", kind: "video", integralFee: 80, vipLevel: 2 },
  { id: 36, name: "kling-o1", kind: "video", integralFee: 120, vipLevel: 2 },
  { id: 37, name: "kling-3.0-omni", kind: "video", integralFee: 85, vipLevel: 2 },
  { id: 38, name: "kling-3.0", kind: "video", integralFee: 85, vipLevel: 2 },
  { id: 39, name: "veo-3.1", kind: "video", integralFee: 155, vipLevel: 2 },
  { id: 40, name: "veo-3", kind: "video", integralFee: 225, vipLevel: 2 },
  { id: 41, name: "veo-3-fast", kind: "video", integralFee: 65, vipLevel: 2 },
  { id: 42, name: "veo-3.1-fast", kind: "video", integralFee: 90, vipLevel: 2 },
  { id: 48, name: "sora-2", kind: "video", integralFee: 55, vipLevel: 2 },
  { id: 49, name: "happy-horse-1.1", kind: "video", integralFee: 110, vipLevel: 2 },
  { id: 52, name: "happy-horse-1.0", kind: "video", integralFee: 110, vipLevel: 2 },
];

export class ModelCatalog {
  private client: UpstreamClient;
  private byName = new Map<string, ModelInfo>();
  private byId = new Map<string, ModelInfo>(); // key: `${kind}:${id}`
  private all: ModelInfo[] = [];
  private lastRefresh = 0;

  constructor(client: UpstreamClient) {
    this.client = client;
    this.loadBuiltin();
  }

  private loadBuiltin() {
    this.all = [...BUILTIN_MODELS];
    this.reindex();
  }

  private reindex() {
    this.byName.clear();
    this.byId.clear();
    for (const m of this.all) {
      if (!this.byName.has(m.name)) this.byName.set(m.name, m);
      this.byId.set(`${m.kind}:${m.id}`, m);
    }
  }

  /** 从上游刷新（失败则保留内置快照） */
  async refresh(): Promise<{ ok: boolean; count: number; error?: string }> {
    try {
      const [imageData, videoData] = await Promise.all([
        this.client.getOk<any>("/api/aiImage/models/v2").catch(() => null),
        this.client.getOk<any>("/api/aiVideo/models/v2").catch(() => null),
      ]);

      const collected: ModelInfo[] = [];
      if (imageData) collected.push(...extractModels(imageData, "image"));
      if (videoData) collected.push(...extractModels(videoData, "video"));

      if (collected.length > 0) {
        // 合并：上游优先，内置补齐缺失的
        const byKey = new Map(collected.map((m) => [`${m.kind}:${m.id}`, m]));
        for (const b of BUILTIN_MODELS) {
          const k = `${b.kind}:${b.id}`;
          if (!byKey.has(k)) byKey.set(k, b);
        }
        this.all = [...byKey.values()];
        this.reindex();
        this.lastRefresh = Date.now();
        return { ok: true, count: this.all.length };
      }
      return { ok: false, count: this.all.length, error: "上游返回空" };
    } catch (e) {
      return { ok: false, count: this.all.length, error: (e as Error).message };
    }
  }

  /** 按 OpenAI model 名查（支持纯数字 id 与 name） */
  resolve(modelRef: string | number | undefined): ModelInfo | null {
    if (modelRef === undefined || modelRef === null || modelRef === "") return null;
    const s = String(modelRef).trim();

    // 1) 按名字
    if (this.byName.has(s)) return this.byName.get(s)!;

    // 2) 纯数字 id：优先 image（生图为主），否则第一个匹配
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return this.byId.get(`image:${n}`) ?? this.all.find((m) => m.id === n) ?? null;
    }

    // 3) 大小写/空格容错
    const norm = s.toLowerCase().replace(/[\s_]+/g, "-");
    for (const [name, m] of this.byName) {
      if (name.toLowerCase().replace(/[\s_]+/g, "-") === norm) return m;
    }
    return null;
  }

  list(kind?: ModelKind): ModelInfo[] {
    return kind ? this.all.filter((m) => m.kind === kind) : this.all;
  }

  get count() {
    return this.all.length;
  }

  get age() {
    return this.lastRefresh ? Date.now() - this.lastRefresh : Infinity;
  }
}

/** 从上游返回结构里递归提取模型 */
function extractModels(root: any, kind: ModelKind): ModelInfo[] {
  const out = new Map<number, ModelInfo>();
  const walk = (x: any, depth: number) => {
    if (depth > 6 || !x) return;
    if (Array.isArray(x)) {
      x.forEach((i) => walk(i, depth + 1));
      return;
    }
    if (typeof x === "object") {
      if (typeof x.title === "string" && typeof x.id === "number") {
        if (!out.has(x.id)) out.set(x.id, toModelInfo(x, kind));
      }
      Object.values(x).forEach((v) => walk(v, depth + 1));
    }
  };
  walk(root, 0);
  return [...out.values()];
}

function toModelInfo(raw: any, kind: ModelKind): ModelInfo {
  const cfg = raw.config ?? {};
  return {
    id: raw.id,
    name: slugify(raw.title),
    kind,
    integralFee: Number(raw.integralFee ?? 0),
    vipLevel: Number(raw.vipLevel ?? 0),
    description: raw.description,
    options: {
      resolutions: cfg.resolutionOptions ?? cfg.imageResolutionOptions ?? cfg.textResolutionOptions,
      aspectRatios: cfg.radioOptions ?? cfg.imageRadioOptions,
      durations: cfg.durationOptions,
      qualities: cfg.qualityOptions,
      modes: cfg.modeOptions,
    },
  };
}

/** 中文/空格 → kebab-case 英文名 */
function slugify(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^\w一-龥.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
