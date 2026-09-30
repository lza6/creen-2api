/**
 * 诊断工具
 *   bun run src/tools/doctor.ts
 *
 * 检查：运行时、配置、上游连通性、token 有效性
 */

import { loadConfig } from "../core/config";
import { UpstreamClient } from "../core/upstream";
import { AuthService, NoopEmailProvider } from "../core/auth";
import { ModelCatalog } from "../core/catalog";

async function main() {
  const cfg = loadConfig();
  const client = new UpstreamClient({ baseUrl: cfg.upstream_base_url, timeoutSec: 30 });
  const auth = new AuthService(client, cfg, new NoopEmailProvider());

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const add = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(28)} ${detail}`);
  };

  console.log("\n" + "=".repeat(70));
  console.log("  Creen-2API 诊断");
  console.log("=".repeat(70) + "\n");

  // 1) 运行时
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  add("运行时", isBun, isBun ? `bun ${(globalThis as any).Bun.version}` : "node（会被 Cloudflare 拦截，请用 bun）");

  // 2) 配置
  add("配置加载", true, `${cfg._configDir}`);
  add("监听地址", /^[\d.]+:\d+$/.test(cfg.listen_addr), cfg.listen_addr);

  // 3) 上游连通
  try {
    const data = await client.getOk<any>("/api/aiImage/models");
    const n = Array.isArray(data) ? data.length : Object.keys(data ?? {}).length;
    add("上游连通（图像模型）", n > 0, `${n} 个`);
  } catch (e) {
    add("上游连通（图像模型）", false, (e as Error).message.slice(0, 60));
  }

  try {
    const data = await client.getOk<any>("/api/aiVideo/models");
    const n = Array.isArray(data) ? data.length : Object.keys(data ?? {}).length;
    add("上游连通（视频模型）", n > 0, `${n} 个`);
  } catch (e) {
    add("上游连通（视频模型）", false, (e as Error).message.slice(0, 60));
  }

  // 4) 积分计算（公开端点）
  try {
    const fee = await client.postOk<number>("/api/aiImage/calculateIntegral", {
      modelId: 1,
      number: 1,
      hasInputImage: false,
    });
    add("积分计算端点", true, `modelId=1 → ${fee} 积分`);
  } catch (e) {
    add("积分计算端点", false, (e as Error).message.slice(0, 60));
  }

  // 5) 目录
  const catalog = new ModelCatalog(client);
  const r = await catalog.refresh();
  add("模型目录刷新", r.ok, r.ok ? `${r.count} 个` : `失败（沿用内置快照 ${r.count} 个）`);
  const kinds = ["image", "video", "comic"].map((k) => `${k}=${catalog.list(k as any).length}`).join(" ");
  add("内置快照", catalog.count > 0, kinds);

  // 6) Token
  console.log("");
  if (cfg.tokens.length === 0) {
    add("Token 配置", false, "未配置（生成功能不可用）");
  } else {
    let valid = 0;
    for (let i = 0; i < cfg.tokens.length; i++) {
      const t = cfg.tokens[i];
      try {
        const c = await auth.checkToken(t);
        if (c.valid) {
          valid++;
          add(`Token #${i + 1}`, true, `有效，积分 ${c.integral ?? "?"}${c.email ? " · " + c.email : ""}`);
        } else {
          add(`Token #${i + 1}`, false, "失效（401）");
        }
      } catch (e) {
        add(`Token #${i + 1}`, false, (e as Error).message.slice(0, 50));
      }
    }
    console.log("");
    add("有效 Token 数", valid > 0, `${valid}/${cfg.tokens.length}`);
  }

  // 7) 邮箱 API（注册机）
  const emailReady = !!(cfg.email_config?.provider && cfg.email_config?.api_base);
  add("邮箱 API（注册机）", emailReady, emailReady ? `${cfg.email_config.provider}` : "未配置（注册机不可用）");

  // 汇总
  const failed = checks.filter((c) => !c.ok);
  console.log("\n" + "=".repeat(70));
  const criticalOk = checks[0].ok && checks.find((c) => c.name.startsWith("上游连通"))?.ok;
  if (failed.length === 0) console.log("  ✓ 全部检查通过");
  else {
    console.log(`  ${criticalOk ? "△" : "✗"} ${failed.length} 项未通过:`);
    failed.forEach((c) => console.log(`     - ${c.name}: ${c.detail}`));
  }
  console.log("=".repeat(70) + "\n");

  process.exit(criticalOk ? 0 : 1);
}

main().catch((e) => {
  console.error("诊断异常:", e);
  process.exit(1);
});
