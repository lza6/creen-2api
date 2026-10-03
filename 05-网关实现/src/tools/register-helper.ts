/**
 * 注册助手（人类在环）
 *   bun run src/tools/register-helper.ts
 *
 * 该工具**不会**自动完成人机验证，也不批量注册。流程：
 *   1) 用邮箱 API 生成一个 catch-all 收件地址
 *   2) 打开可见浏览器到 creen.ai
 *   3) 【你】在页面选注册，填入下面显示的邮箱 / 密码，手动过 Cloudflare Turnstile，提交
 *   4) 工具自动从邮箱 API 读到验证码并显示
 *   5) 【你】把验证码填入页面
 *   6) 工具自动探测登录 token，校验有效并写入 data/accounts.json
 *
 * 用途：帮你自动化"取验证码 / 落库 token"这些琐碎步骤，验证与注册动作由你本人完成。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../core/config";
import { CloudMailClient } from "../core/mail-api";
import { launchBrowser } from "./cdp";
import { genPassword } from "../core/auth";

const PORT = 9243;
const PROFILE_DIR = join(tmpdir(), "creen-2api-register-profile");

async function main() {
  const cfg = loadConfig();
  const mail = CloudMailClient.fromConfig(cfg);

  console.log("\n" + "=".repeat(64));
  console.log("  Creen 注册助手（人类在环）");
  console.log("=".repeat(64));

  if (!mail) {
    console.error("✗ 未配置 mail_api。请先在 config.local.json 写入 mail_api 配置。");
    process.exit(1);
  }

  // 1) 生成收件地址 + 密码
  const email = await mail.allocateAddress();
  const password = genPassword();

  console.log(`\n  邮箱:  ${email}`);
  console.log(`  密码:  ${password}`);
  console.log(`\n  >> 浏览器即将打开 creen.ai，请：`);
  console.log(`     1. 打开「注册 / Sign up」`);
  console.log(`     2. 填入上面的邮箱与密码`);
  console.log(`     3. 手动完成 Cloudflare 人机验证`);
  console.log(`     4. 点击提交（这会触发验证码邮件）`);
  console.log(`\n     提交后请回到本窗口，工具会自动读出验证码。`);
  console.log("=".repeat(64) + "\n");

  // 2) 打开浏览器
  console.log("[browser] 启动中…");
  const b = await launchBrowser({
    url: "https://www.creen.ai/",
    port: PORT,
    profileDir: PROFILE_DIR,
    headless: false,
  });
  console.log("[browser] 已打开。请在窗口中完成注册步骤 1-4。\n");

  // 3) 记录当前收件基线，只关注新邮件
  let sinceEmailId = 0;
  try {
    sinceEmailId = await mail.maxEmailId(email);
  } catch {
    /* 新地址通常为空 */
  }

  // 4) 等待验证码
  console.log("[mail] 等待验证码邮件（最多 5 分钟）…");
  let code: string;
  try {
    const r = await mail.waitForCode(email, { timeoutMs: 300_000, sinceEmailId, intervalMs: 3000 });
    code = r.code;
  } catch (e) {
    console.error(`\n✗ ${(e as Error).message}`);
    console.error("  可重新提交注册（重发验证码），或检查邮箱配置。");
    b.close();
    process.exit(1);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`  ✓ 验证码:  ${code}`);
  console.log("=".repeat(64));
  console.log("  >> 请把上面的验证码填入浏览器页面的验证码框并提交。\n");

  // 5) 轮询页面 token
  console.log("[browser] 等待注册完成（检测到登录 token 即成功，最多 5 分钟）…");
  const deadline = Date.now() + 5 * 60_000;
  let token: string | null = null;
  while (Date.now() < deadline) {
    try {
      const v = await b.cdp.evaluate<string | null>(
        `localStorage.getItem("x-auth-token")`,
        b.sessionId
      );
      if (v && v.length > 20) {
        token = v;
        break;
      }
    } catch {
      /* 页面可能导航中 */
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("");

  if (!token) {
    console.error("✗ 未检测到 token（超时或注册未完成）。");
    b.close();
    process.exit(1);
  }

  // 6) 校验并落库
  console.log("[verify] 校验 token 有效性…");
  try {
    const res = await fetch(cfg.upstream_base_url.replace(/\/+$/, "") + "/api/auth/getAccount", {
      headers: {
        "x-auth-token": token,
        "x-platform": "web",
        "x-version": "999.0.0",
        "x-language": "en",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        referer: cfg.upstream_base_url + "/",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await res.json();
    if (String(j.code) === "200") {
      console.log(`  ✓ token 有效 · 积分 ${j.data?.integral ?? "?"} · 邮箱 ${j.data?.email ?? "?"}`);
    } else {
      console.warn(`  ⚠ 校验返回: ${j.msg ?? j.code}（仍写入，供后续诊断）`);
    }
  } catch (e) {
    console.warn(`  ⚠ 校验失败: ${(e as Error).message}`);
  }

  saveAccount(cfg._configDir, { token, email, password });
  b.close();
  console.log("\n✓ 完成。可运行 `bun run src/tools/doctor.ts` 复核。\n");
  process.exit(0);
}

function saveAccount(configDir: string, r: { token: string; email: string; password: string }) {
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
    store.tokens.push({ token: r.token, email: r.email, note: "register-helper" });
  }
  if (!store.accounts.some((a: any) => a.email === r.email)) {
    store.accounts.push({ email: r.email, password: r.password });
  }
  store.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
  console.log(`  → 已保存到 ${path}`);
}

main().catch((e) => {
  console.error("\n✗ 注册助手异常:", (e as Error).message);
  process.exit(1);
});
