/**
 * 生成服务：提交任务 → 轮询状态 → 返回结果 URL
 *
 * 上游协议（逆向自 02-源码分析文档/07）：
 *  1) 提交：POST /api/aiImage/create/v2  或  /api/aiVideo/create/v2
 *     → { code: 1, resultId, newProjectData? }
 *  2) 轮询：POST /api/aiImage/getListTaskStatus 或 /api/aiVideo/checkJobStatus
 *     → status: "SUCCESS"|"2" 成功；"FAILED"|"3" 失败
 *  3) 详情：GET /api/aiImage/{id} 或 /api/aiVideo/getMyResultDetail?id=
 */

import type { UpstreamClient } from "./upstream";
import { UpstreamError } from "./upstream";
import type { ModelInfo } from "./catalog";
import type { Config } from "./config";

export interface GenerateOptions {
  model: ModelInfo;
  prompt: string;
  /** 参考图 URL 列表（已上传） */
  imageUrls?: string[];
  /** 输出数量 */
  n?: number;
  /** 分辨率 */
  resolution?: string;
  /** 宽高比 */
  aspectRatio?: string;
  /** 画质 */
  quality?: string;
  /** 视频时长（秒） */
  duration?: number;
  /** 视频模式 */
  mode?: string;
  /** 是否公开 */
  publicVisible?: boolean;
  /** 项目 ID */
  projectId?: number;
}

export interface TaskStatus {
  status: "pending" | "success" | "failed";
  progress?: number;
  resultUrls?: string[];
  errorMessage?: string;
  raw?: any;
}

export class GenerationService {
  private client: UpstreamClient;
  private cfg: Config;

  constructor(client: UpstreamClient, cfg: Config) {
    this.client = client;
    this.cfg = cfg;
  }

  /** 计算所需积分（公开端点，无需认证） */
  async estimateIntegral(opts: GenerateOptions, token?: string): Promise<number> {
    const { model, prompt, imageUrls = [], n = 1, resolution, quality, aspectRatio, duration } = opts;

    try {
      if (model.kind === "image" || model.kind === "comic") {
        const data = await this.client.postOk<number>(
          "/api/aiImage/calculateIntegral",
          {
            modelId: model.id,
            hasInputImage: imageUrls.length > 0,
            number: n,
            ...(resolution ? { resolution } : {}),
            ...(quality ? { quality } : {}),
            ...(aspectRatio ? { aspectRatio } : {}),
          },
          token
        );
        return Number(data ?? 0);
      }
      if (model.kind === "video") {
        const data = await this.client.postOk<number>(
          "/api/aiVideo/calculateIntegral",
          {
            modelId: model.id,
            length: duration ?? 5,
            number: n,
            enableAudio: false,
            mode: modeToCode(opts.mode),
            ...(resolution ? { resolution } : {}),
            ...(aspectRatio ? { aspectRatio } : {}),
          },
          token
        );
        return Number(data ?? 0);
      }
    } catch {
      // 计算失败时退回模型基础价
    }
    return model.integralFee * Math.max(1, n);
  }

  /** 提交任务，返回 resultId */
  async submit(opts: GenerateOptions, token: string): Promise<{ resultId: string; newProjectId?: number }> {
    const { model, prompt, imageUrls = [], n = 1, resolution, quality, aspectRatio, duration, projectId } = opts;

    if (!token) throw new UpstreamError("生成需要登录 token（游客登录已失效）", "NO_TOKEN", 0);

    let path: string;
    let body: any;

    if (model.kind === "image" || model.kind === "comic") {
      path = model.kind === "comic" ? "/api/aiComic/create" : "/api/aiImage/create/v2";
      body = {
        modelId: model.id,
        baseImage: imageUrls[0] ?? "",
        imageUrls: imageUrls.slice(1),
        prompt,
        number: n,
        permission: opts.publicVisible === false ? 0 : 1,
        ...(resolution ? { resolution } : {}),
        ...(quality ? { quality } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(projectId ? { projectId } : {}),
      };
    } else if (model.kind === "video") {
      path = "/api/aiVideo/create/v2";
      body = {
        modelId: model.id,
        mode: modeToCode(opts.mode),
        images: imageUrls.length ? imageUrls : undefined,
        prompt,
        length: duration ?? 5,
        number: n,
        permission: opts.publicVisible === false ? 0 : 1,
        enableAudio: false,
        ...(resolution ? { resolution } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(projectId ? { projectId } : {}),
      };
    } else {
      throw new UpstreamError(`暂不支持的模型类型: ${model.kind}`, "UNSUPPORTED", 0);
    }

    const env = await this.client.post<any>(path, body, token);

    // 异步任务成功码为数字 1（见 02-源码分析文档/02 §3）
    if (Number(env.code) === 1) {
      const data = env.data ?? {};
      return { resultId: String(data.resultId ?? ""), newProjectId: data.newProjectData?.id };
    }

    // 业务错误码
    const code = Number(env.code);
    const msg = businessError(code, env.msg);
    throw new UpstreamError(msg, env.code, 0, env);
  }

  /** 轮询任务状态 */
  async poll(resultId: string, kind: ModelInfo["kind"], token: string): Promise<TaskStatus> {
    const maxAttempts = this.cfg.poll_max_attempts;
    const interval = this.cfg.poll_interval_sec * 1000;

    for (let i = 0; i < maxAttempts; i++) {
      await sleep(interval);

      let items: any[] = [];
      try {
        if (kind === "video") {
          const env = await this.client.post<any>("/api/aiVideo/checkJobStatus", { resultIds: [resultId] }, token);
          items = Array.isArray(env.data) ? env.data : env.data ? [env.data] : [];
        } else {
          const env = await this.client.post<any>("/api/aiImage/getListTaskStatus", { resultIds: [resultId] }, token);
          items = Array.isArray(env.data) ? env.data : env.data ? [env.data] : [];
        }
      } catch (e) {
        // 轮询失败不立即放弃（网络抖动）
        if (i > 3) throw e;
        continue;
      }

      const item = items[0];
      if (!item) continue;

      const st = String(item.status ?? "");
      if (st === "SUCCESS" || st === "2") {
        return { status: "success", resultUrls: extractResultUrls(item), raw: item };
      }
      if (st === "FAILED" || st === "3") {
        return { status: "failed", errorMessage: item.errorMessage ?? "生成失败", raw: item };
      }
      // 进行中
    }
    return { status: "failed", errorMessage: `轮询超时（${maxAttempts} 次 × ${this.cfg.poll_interval_sec}s）` };
  }

  /** 获取结果详情（部分场景轮询不含 URL，需再查详情） */
  async fetchDetail(resultId: string, kind: ModelInfo["kind"], token: string): Promise<any> {
    if (kind === "video") {
      return this.client.getOk<any>(`/api/aiVideo/getMyResultDetail?id=${encodeURIComponent(resultId)}`, token);
    }
    return this.client.getOk<any>(`/api/aiImage/${encodeURIComponent(resultId)}`, token);
  }
}

/** 从任务结果提取图片/视频 URL */
export function extractResultUrls(item: any): string[] {
  if (!item || typeof item !== "object") return [];
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) out.push(v);
  };

  if (Array.isArray(item.resultImages)) item.resultImages.forEach(push);
  if (Array.isArray(item.resultImageList)) item.resultImageList.forEach(push);
  push(item.resultImage);
  push(item.previewImage);
  push(item.resultVideo);
  push(item.videoUrl);
  push(item.url);

  // 递归兜底：找 dataList / results
  const walk = (x: any, d: number) => {
    if (d > 4 || !x) return;
    if (Array.isArray(x)) return x.forEach((i) => walk(i, d + 1));
    if (typeof x === "object") {
      for (const k of ["url", "imageUrl", "videoUrl", "resultUrl", "filePath", "path"]) push(x[k]);
      Object.values(x).forEach((v) => walk(v, d + 1));
    }
  };
  walk(item, 0);

  return [...new Set(out)];
}

/** 业务错误码 → 中文提示（见 02-源码分析文档/08） */
export function businessError(code: number, fallback?: string): string {
  switch (code) {
    case -1:
      return "积分不足";
    case -2:
      return "生成失败";
    case -3:
      return "内容审核未通过 / 已有任务进行中";
    case -4:
      return "任务数超限";
    case -5:
      return "操作过于频繁，请稍后重试";
    case -6:
      return "自定义音色数量已达上限";
    default:
      return fallback || `上游错误 (code=${code})`;
  }
}

function modeToCode(mode?: string): string {
  switch ((mode ?? "").toLowerCase()) {
    case "text_to_video":
    case "t2v":
      return "1";
    case "frames":
    case "first_last_frame":
      return "2";
    case "reference":
    case "reference_to_video":
      return "3";
    default:
      return "1";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
