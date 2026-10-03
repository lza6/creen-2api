/**
 * Creen-2API 网关入口
 *
 * ⚠ 必须用 bun 运行：`bun run src/index.ts`
 *   Node 原生 https/http2 会因 TLS 指纹被 Cloudflare 拦截（403）。
 */

import { loadConfig } from "./core/config";
import { UpstreamClient } from "./core/upstream";
import { AccountPool } from "./core/account-pool";
import { ModelCatalog } from "./core/catalog";
import { GenerationService } from "./core/generation";
import { AuthService, NoopEmailProvider } from "./core/auth";
import {
  handleModels,
  handleImageGenerations,
  handleVideoGenerations,
  handleChatCompletions,
  jsonResponse,
  errorResponse,
  type ApiContext,
} from "./api/openai";
import { startWeb } from "./web/panel";
import { startAutoRenew } from "./core/auto-renew";
import {
  authenticateGateway,
  ConcurrencyGate,
  getClientIp,
  SlidingWindowRateLimiter,
} from "./core/middleware";
import { MediaStore } from "./core/media";

const VERSION = "0.1.0";

/* ---------- 运行时校验 ---------- */

function assertBunRuntime() {
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  if (!isBun) {
    console.error(
      "\n" +
        "=".repeat(66) +
        "\n" +
        "  ⚠  必须使用 bun 运行！\n" +
        "\n" +
        "  原因：Node 原生 TLS 指纹会被 Cloudflare 拦截（返回 403）。\n" +
        "  bun 的内置 TLS 栈可正常通过。\n" +
        "\n" +
        "  正确用法：  bun run src/index.ts\n" +
        "  或：        npm start   (已配置为 bun)\n" +
        "=".repeat(66) +
        "\n"
    );
    process.exit(1);
  }
}

/* ---------- 启动 ---------- */

async function main() {
  assertBunRuntime();

  const cfg = loadConfig();
  console.log(`\n┌─ Creen-2API v${VERSION} ${"─".repeat(40)}`);
  console.log(`│ 上游:   ${cfg.upstream_base_url}`);
  console.log(`│ 监听:   http://${cfg.listen_addr}`);
  console.log(`│ 配置:   ${cfg._configDir}`);

  const client = new UpstreamClient({
    baseUrl: cfg.upstream_base_url,
    timeoutSec: cfg.request_timeout_sec,
  });

  const catalog = new ModelCatalog(client);
  const pool = new AccountPool(cfg, client);
  const gen = new GenerationService(client, cfg);
  const auth = new AuthService(client, cfg, new NoopEmailProvider());
  const media = new MediaStore(cfg, client);

  // 中间件
  const gate = new ConcurrencyGate(cfg.max_concurrent_requests);
  const limiter = new SlidingWindowRateLimiter(cfg.rate_limit_requests, cfg.rate_limit_window_sec * 1000);
  // 定期清理限流桶（避免内存增长）
  setInterval(() => limiter.prune(), Math.max(60_000, cfg.rate_limit_window_sec * 1000)).unref?.();

  const ctx: ApiContext = { cfg, catalog, pool, gen, client, media };

  console.log(`│ 模型:   ${catalog.count} 个（内置快照）`);
  console.log(`│ 账号:   ${pool.size} 个 token`);
  console.log(`│ 鉴权:   ${cfg.gateway_api_key ? "已启用 gateway_api_key" : "未启用（仅本机建议）"}`);
  console.log(`│ 限流:   ${cfg.rate_limit_enabled ? `${cfg.rate_limit_requests} 次 / ${cfg.rate_limit_window_sec}s` : "关闭"}`);
  console.log(`│ 并发:   ${cfg.max_concurrent_requests > 0 ? cfg.max_concurrent_requests : "不限"}`);
  console.log(`│ 媒体:   ${cfg.download_media ? `落盘 ${media.directory}` : "仅返回上游 URL"}`);
  console.log(`└${"─".repeat(56)}\n`);

  // 后台刷新目录
  void (async () => {
    const r = await catalog.refresh();
    if (r.ok) console.log(`[catalog] 上游刷新成功，共 ${r.count} 个模型`);
    else console.log(`[catalog] 上游刷新失败（沿用内置快照）: ${r.error}`);

    if (pool.size > 0) {
      await pool.refreshIntegrals();
      const snap = pool.snapshot();
      console.log(`[pool] 积分快照: ${snap.map((t) => `${t.email ?? t.token}=${t.integral ?? "?"}`).join(", ")}`);
    }
  })();

  // 定时刷新目录
  if (cfg.catalog_refresh_min > 0) {
    setInterval(() => void catalog.refresh(), cfg.catalog_refresh_min * 60_000).unref?.();
  }

  // 自动续期
  if (cfg.auto_renew && cfg.auto_renew) {
    startAutoRenew({ cfg, pool, auth });
  }

  const port = Number(cfg.listen_addr.split(":")[1] ?? 47840);
  const host = cfg.listen_addr.split(":")[0] ?? "127.0.0.1";

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 255,
    async fetch(req: Request) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method.toUpperCase();

      try {
        // CORS 预检（最先处理，不鉴权）
        if (method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // 健康检查：始终公开（编排/K8s 探针用）；只暴露最小状态，避免侦察
        if (path === "/healthz") {
          return withCors(jsonResponse({ status: "ok", version: VERSION }));
        }

        // 本地媒体（路径穿越防护 + HMAC 签名校验；<img>/<video> 无法带自定义头故用签名）
        if (path.startsWith("/media/")) {
          const mediaPath = path.slice("/media/".length);
          const name = decodeURIComponent(mediaPath);
          if (!media.verify(name, url.searchParams.get("sig"))) {
            return withCors(errorResponse("媒体链接无效或已过期", "invalid_request_error", 403));
          }
          return withCors(serveMedia(name, media));
        }

        // Web 面板外壳（纯静态 HTML，不含密钥；用户 key 由面板内输入）
        if (cfg.ui_enabled && (path === "/" || path === "/ui") && method === "GET") {
          return await startWeb(ctx);
        }

        // 网关入口鉴权（/healthz、/ui、/media 已提前返回）
        const authz = authenticateGateway(req, cfg, path);
        if (!authz.ok) {
          return withCors(errorResponse(authz.message, "authentication_error", 401, "invalid_api_key"));
        }

        // 限流（仅生成类端点；管理端点不限，避免自锁）
        const isGeneration =
          path === "/v1/images/generations" || path === "/v1/videos/generations" || path === "/v1/chat/completions";
        if (cfg.rate_limit_enabled && isGeneration) {
          const ip = getClientIp(req, server as any, cfg.trust_proxy);
          const rl = limiter.check(ip);
          if (!rl.allowed) {
            const res = errorResponse("请求过于频繁，请稍后重试", "rate_limit_error", 429, "rate_limited");
            const h = new Headers(res.headers);
            h.set("retry-after", String(rl.retryAfterSec));
            return withCors(new Response(res.body, { status: 429, headers: h }));
          }
        }

        // ---- OpenAI 兼容 ----
        if (path === "/v1/models" && method === "GET") return withCors(handleModels(ctx));
        if (path === "/v1/images/generations" && method === "POST") {
          return withCors(await gate.run(() => handleImageGenerations(req, ctx)));
        }
        if (path === "/v1/videos/generations" && method === "POST") {
          return withCors(await gate.run(() => handleVideoGenerations(req, ctx)));
        }
        if (path === "/v1/chat/completions" && method === "POST") {
          return withCors(await gate.run(() => handleChatCompletions(req, ctx)));
        }

        // ---- 管理 API ----
        if (path === "/api/status" && method === "GET") {
          return withCors(
            jsonResponse({
              version: VERSION,
              upstream: cfg.upstream_base_url,
              catalog: { count: catalog.count, age_ms: catalog.age },
              pool: pool.snapshot(),
            })
          );
        }
        if (path === "/api/catalog/refresh" && method === "POST") {
          const r = await catalog.refresh();
          return withCors(jsonResponse(r));
        }
        if (path === "/api/pool/refresh" && method === "POST") {
          await pool.refreshIntegrals();
          return withCors(jsonResponse({ ok: true, pool: pool.snapshot() }));
        }
        if (path === "/api/pool/add" && method === "POST") {
          const b = (await req.json()) as any;
          if (!b?.token) return withCors(errorResponse("缺少 token"));
          const t = pool.add(String(b.token), b.email, b.note);
          return withCors(jsonResponse({ ok: true, token: t.token.slice(0, 12) + "…" }));
        }

        // ---- Web 面板（已在鉴权前处理；此处仅为非 GET 兜底） ----
        if (cfg.ui_enabled && (path === "/" || path === "/ui")) {
          return withCors(errorResponse("仅支持 GET", "invalid_request_error", 405));
        }

        return withCors(errorResponse(`未知路由 ${method} ${path}`, "invalid_request_error", 404));
      } catch (e) {
        // 详细错误只写服务端日志；对外返回泛化消息，避免泄露上游/内部细节
        console.error(`[http] ${method} ${path} 异常:`, (e as Error).message);
        return withCors(errorResponse("内部错误，请稍后重试", "api_error", 500));
      }
    },
  });

  console.log(`✓ 网关已启动: http://${host}:${port}`);
  console.log(`  面板:      http://${host}:${port}/ui`);
  console.log(`  OpenAI:    http://${host}:${port}/v1`);
  if (pool.size === 0) {
    console.log(`\n⚠ 当前无可用 token，生成功能不可用。`);
    console.log(`  填入 config.json 的 tokens，或运行: bun run src/tools/login-helper.ts\n`);
  }

  // 优雅退出
  const shutdown = () => {
    console.log("\n[main] 正在关闭…");
    try {
      server.stop(true);
    } catch {
      /* ignore */
    }
    pool.save();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-api-key",
    "access-control-max-age": "86400",
  };
}

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/** 提供本地媒体文件（带路径穿越保护与缓存头） */
function serveMedia(name: string, media: MediaStore): Response {
  const full = media.localPath(decodeURIComponent(name));
  if (!full) return errorResponse("媒体不存在", "invalid_request_error", 404);

  const file = Bun.file(full);
  const type = file.type || "application/octet-stream";
  return new Response(file, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

main().catch((e) => {
  console.error("[main] 启动失败:", e);
  process.exit(1);
});
