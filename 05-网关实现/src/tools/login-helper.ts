/**
 * 登录助手：用 CDP 打开浏览器，让用户登录，自动提取 x-auth-token
 *
 * 用法：
 *   bun run src/tools/login-helper.ts            # 打开浏览器，登录后自动提取
 *   bun run src/tools/login-helper.ts --headless # 无头（若已有 profile 登录态）
 *
 * 提取的 token 会写入 data/accounts.json。
 * 依赖：本机需安装 Chrome/Edge。通过原生 CDP WebSocket 通信（无需 puppeteer）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { launchBrowser } from "./cdp";

const PORT = 9241;
const PROFILE_DIR = join(tmpdir(), "creen-2api-login-profile");
const UPSTREAM = "https://www.creen.ai";

/* ---------- 主流程 ---------- */

async function main() {
  const headless = process.argv.includes("--headless");
  const url = UPSTREAM + "/";

  console.log(`配置文件:   ${PROFILE_DIR}`);
  mkdirSync(PROFILE_DIR, { recursive: true });

  const b = await launchBrowser({ url, port: PORT, profileDir: PROFILE_DIR, headless });

  try {
    if (!headless) {
      console.log("\n" + "=".repeat(60));
      console.log("  请在打开的浏览器窗口中完成登录");
      console.log("  登录成功后，本工具会自动检测并提取 token");
      console.log("  （等待最多 5 分钟，按 Ctrl+C 取消）");
      console.log("=".repeat(60) + "\n");
    }

    // 轮询 localStorage 里的 token
    const deadline = Date.now() + 5 * 60_000;
    let token: string | null = null;
    let email: string | null = null;

    while (Date.now() < deadline) {
      try {
        const raw = await b.cdp.evaluate<string>(
          `JSON.stringify({token: localStorage.getItem("x-auth-token"), info: localStorage.getItem("x-auth-user")})`,
          b.sessionId
        );
        const parsed = JSON.parse(raw ?? "{}");
        if (parsed.token) {
          token = parsed.token;
          try {
            email = JSON.parse(parsed.info ?? "{}")?.email ?? null;
          } catch {
            /* ignore */
          }
          break;
        }
      } catch {
        /* 页面可能还在导航 */
      }
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("");

    if (!token) {
      console.error("✗ 未能提取 token（超时或未登录）。可手动从 DevTools → Application → Local Storage 复制 x-auth-token。");
      b.close();
      process.exit(1);
    }

    // 写入 data/accounts.json
    const storePath = resolve(process.cwd(), "data", "accounts.json");
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
    let store: any = { tokens: [], updatedAt: new Date().toISOString() };
    if (existsSync(storePath)) {
      try {
        store = JSON.parse(readFileSync(storePath, "utf8"));
      } catch {
        /* ignore */
      }
    }
    if (!store.tokens.some((t: any) => t.token === token)) {
      store.tokens.push({ token, email: email ?? undefined, integral: undefined, note: "login-helper" });
      store.updatedAt = new Date().toISOString();
      writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
    }

    // 验证 token 有效性
    console.log("✓ 已提取 token: " + token.slice(0, 16) + "…");
    try {
      const check = await fetch(UPSTREAM + "/api/auth/getAccount", {
        headers: {
          "x-auth-token": token,
          "x-platform": "web",
          "x-version": "999.0.0",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          referer: UPSTREAM + "/",
        },
        signal: AbortSignal.timeout(30_000),
      });
      const j: any = await check.json();
      if (String(j.code) === "200") {
        console.log(`✓ token 有效，账号积分: ${j.data?.integral ?? "?"}, 邮箱: ${j.data?.email ?? "?"}`);
      } else {
        console.warn(`⚠ token 校验返回: ${j.msg ?? j.code}`);
      }
    } catch (e) {
      console.warn(`⚠ token 校验失败: ${(e as Error).message}`);
    }

    console.log(`\n已写入 ${storePath}`);
    console.log(`网关会自动读取（重启后生效），或运行:`);
    console.log(`  curl -X POST http://127.0.0.1:47840/api/pool/add \\`);
    console.log(`    -H "authorization: Bearer $CREEN_GATEWAY_API_KEY" \\`);
    console.log(`    -H "content-type: application/json" -d '{"token":"${token.slice(0, 16)}..."}'`);
    console.log(`  （若未配置 gateway_api_key，可省略 authorization 头）`);

    b.close();
    process.exit(0);
  } catch (e) {
    console.error("✗ 失败:", (e as Error).message);
    b.close();
    process.exit(1);
  }
}

main();
