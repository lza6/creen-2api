/**
 * 注册机框架
 *
 * ⚠ 当前状态：框架已就绪，**等待邮箱 API 配置**。
 *   在 config.json 的 email_config 填入邮箱服务商信息后即可批量注册。
 *
 * 用法：
 *   bun run src/tools/register-bot.ts             # 注册 1 个
 *   bun run src/tools/register-bot.ts --count 5   # 注册 5 个
 *   bun run src/tools/register-bot.ts --dry-run   # 仅检查配置与环境
 *
 * 流程：
 *   1) 分配邮箱（邮箱 API）
 *   2) POST /api/auth/regSubmit  → 触发验证码邮件
 *   3) 轮询邮箱 API 提取 6 位验证码
 *   4) POST /api/auth/confirmReg → 拿到 idToken
 *   5) POST /api/auth/setNickname
 *   6) 写入 data/accounts.json + config 的 accounts 候选
 *
 * 已知限制：
 *   - 站点注册需 Turnstile 人机验证（turnstileToken）。当前提交空 token；
 *     若上游强制校验，需接入打码服务（预留 hook）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type EmailConfig } from "../core/config";
import { UpstreamClient, UpstreamError } from "../core/upstream";
import { HttpEmailProvider, AuthService, genPassword, NoopEmailProvider, type EmailProvider } from "../core/auth";

/* ---------- 邮箱 Provider 适配 ---------- */

/**
 * 根据 email_config.provider 构造具体 Provider。
 *
 * 目前内置一个「通用 HTTP 邮箱」适配器模板；接入新服务商时：
 *   1) 在 ADAPTERS 里加一项
 *   2) 实现 allocatePath / inboxPath / 解析函数
 */
const ADAPTERS: Record<string, (cfg: EmailConfig) => EmailProvider> = {
  /**
   * 通用适配器：适用于大多数「REST 临时邮箱 API」
   * 需在 config.email_config 里补充 mapping 字段（见下方 DEFAULT_MAPPING）
   */
  generic_http: (cfg) => {
    const mapping = (cfg as any).mapping ?? DEFAULT_MAPPING;
    return new HttpEmailProvider(cfg, mapping);
  },

  /** 示例：自建域名邮箱（通过 catch-all + IMAP 转 HTTP 网关） */
  // "my_domain": (cfg) => new HttpEmailProvider(cfg, MY_DOMAIN_MAPPING),
};

const DEFAULT_MAPPING = {
  allocatePath: "/api/mail/new",
  allocateMethod: "POST",
  parseAddress: (j: any) => j?.address ?? j?.email ?? j?.data?.address ?? "",
  parseId: (j: any) => j?.id ?? j?.data?.id,
  inboxPath: "/api/mail/{address}",
  parseMessages: (j: any) => {
    const arr = Array.isArray(j) ? j : (j?.messages ?? j?.data ?? []);
    return arr.map((m: any) => ({
      text: String(m?.subject ?? "") + " " + String(m?.text ?? m?.body ?? m?.content ?? ""),
      ts: m?.ts ? new Date(m.ts).getTime() : undefined,
    }));
  },
};

function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (!cfg.provider || !cfg.api_base) {
    console.warn(
      "[register] ⚠ 未配置邮箱 API（config.email_config.provider / api_base）。\n" +
        "         注册机将无法完成验证码步骤。\n" +
        "         请填入邮箱服务商信息后重试。"
    );
    return new NoopEmailProvider();
  }
  const factory = ADAPTERS[cfg.provider];
  if (!factory) {
    console.warn(`[register] ⚠ 未知的 provider: ${cfg.provider}。可用: ${Object.keys(ADAPTERS).join(", ")}`);
    return new NoopEmailProvider();
  }
  return factory(cfg);
}

/* ---------- 主流程 ---------- */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const countIdx = args.indexOf("--count");
  const count = countIdx >= 0 ? Math.max(1, parseInt(args[countIdx + 1] ?? "1", 10)) : 1;

  const cfg = loadConfig();
  const client = new UpstreamClient({ baseUrl: cfg.upstream_base_url, timeoutSec: 60 });
  const emailProvider = buildEmailProvider(cfg.email_config);
  const auth = new AuthService(client, cfg, emailProvider);

  console.log("=".repeat(60));
  console.log("  Creen 注册机");
  console.log("=".repeat(60));
  console.log(`  上游:     ${cfg.upstream_base_url}`);
  console.log(`  邮箱 API: ${cfg.email_config.provider || "(未配置)"} ${cfg.email_config.api_base || ""}`);
  console.log(`  数量:     ${count}`);
  console.log(`  模式:     ${dryRun ? "DRY-RUN（仅检查）" : "实际注册"}`);
  console.log("=".repeat(60) + "\n");

  // 环境自检
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  console.log(`[自检] 运行时: ${isBun ? "bun ✓" : "node ✗ (会被 Cloudflare 拦截)"}`);
  console.log(`[自检] 邮箱 API: ${emailProvider instanceof NoopEmailProvider ? "未配置 ✗" : "已配置 ✓"}`);

  // 连通性测试
  try {
    const models = await client.getOk<any>("/api/aiImage/models");
    const n = Array.isArray(models) ? models.length : Object.keys(models ?? {}).length;
    console.log(`[自检] 上游连通: ✓（图像模型 ${n} 个）`);
  } catch (e) {
    console.error(`[自检] 上游连通: ✗ ${(e as Error).message}`);
    if (!isBun) {
      console.error("\n✗ 请用 bun 运行: bun run src/tools/register-bot.ts");
    }
    process.exit(1);
  }

  if (emailProvider instanceof NoopEmailProvider) {
    console.log("\n⚠ 邮箱 API 未配置 —— 无法完成注册（需接收验证码）。");
    console.log("\n请在 config.json 中填入 email_config，例如：");
    console.log(
      JSON.stringify(
        {
          email_config: {
            provider: "generic_http",
            api_base: "https://your-temp-mail-api.example.com",
            api_key: "YOUR_API_KEY",
            domain: "",
            mapping: DEFAULT_MAPPING,
          },
        },
        null,
        2
      )
    );
    console.log("\n配置后即可运行实际注册。框架已就绪（AuthService.register 已实现完整流程）。");
    process.exit(2);
  }

  if (dryRun) {
    console.log("\n✓ DRY-RUN 通过：环境就绪，可执行实际注册。");
    process.exit(0);
  }

  // 实际注册
  const results: Array<{ email: string; ok: boolean; error?: string }> = [];
  for (let i = 1; i <= count; i++) {
    console.log(`\n[${i}/${count}] 注册中…`);
    try {
      const r = await auth.register({});
      console.log(`  ✓ ${r.email} (token ${r.token.slice(0, 12)}…)`);
      results.push({ email: r.email, ok: true });
      saveAccount(cfg._configDir, r);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`  ✗ 失败: ${msg}`);
      results.push({ email: "(unknown)", ok: false, error: msg });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  注册完成: ${ok}/${count} 成功`);
  console.log("=".repeat(60));
  process.exit(ok === count ? 0 : 1);
}

function saveAccount(configDir: string, r: { token: string; email: string; password: string; nickname?: string }) {
  const dir = resolve(configDir, "data");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "accounts.json");
  let store: any = { tokens: [], accounts: [], updatedAt: "" };
  if (existsSync(path)) {
    try {
      store = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* ignore */
    }
  }
  if (!store.accounts) store.accounts = [];
  if (!store.tokens.some((t: any) => t.token === r.token)) {
    store.tokens.push({ token: r.token, email: r.email, note: "registered" });
  }
  if (!store.accounts.some((a: any) => a.email === r.email)) {
    store.accounts.push({ email: r.email, password: r.password, nickname: r.nickname });
  }
  store.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
  console.log(`  → 已保存到 ${path}`);
}

main().catch((e) => {
  console.error("注册机异常:", e);
  process.exit(1);
});
