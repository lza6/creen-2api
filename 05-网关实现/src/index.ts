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

  const ctx: ApiContext = { cfg, catalog, pool, gen, client };

  console.log(`│ 模型:   ${catalog.count} 个（内置快照）`);
  console.log(`│ 账号:   ${pool.size} 个 token`);
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
        // CORS
        if (method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: corsHeaders(),
          });
        }

        // ---- OpenAI 兼容 ----
        if (path === "/v1/models" && method === "GET") return withCors(handleModels(ctx));
        if (path === "/v1/images/generations" && method === "POST") return withCors(await handleImageGenerations(req, ctx));
        if (path === "/v1/videos/generations" && method === "POST") return withCors(await handleVideoGenerations(req, ctx));
        if (path === "/v1/chat/completions" && method === "POST") return withCors(await handleChatCompletions(req, ctx));

        // ---- 健康检查 ----
        if (path === "/healthz") {
          return withCors(
            jsonResponse({
              status: "ok",
              version: VERSION,
              runtime: typeof (globalThis as any).Bun !== "undefined" ? "bun" : "node",
              models: catalog.count,
              tokens: pool.size,
              activeTokens: pool.activeCount(),
            })
          );
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

        // ---- Web 面板 ----
        if (cfg.ui_enabled && (path === "/" || path === "/ui")) {
          return await startWeb(ctx);
        }

        return withCors(errorResponse(`未知路由 ${method} ${path}`, "invalid_request_error", 404));
      } catch (e) {
        console.error(`[http] ${method} ${path} 异常:`, (e as Error).message);
        return withCors(errorResponse((e as Error).message, "api_error", 500));
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

main().catch((e) => {
  console.error("[main] 启动失败:", e);
  process.exit(1);
});
