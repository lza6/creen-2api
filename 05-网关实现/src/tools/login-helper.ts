/**
 * 登录助手：用 CDP 打开浏览器，让用户登录，自动提取 x-auth-token
 *
 * 用法：
 *   bun run src/tools/login-helper.ts            # 打开浏览器，登录后自动提取
 *   bun run src/tools/login-helper.ts --headless # 无头（若已有 profile 登录态）
 *
 * 提取的 token 会写入 data/accounts.json 与提示追加到 config.json。
 *
 * 依赖：本机需安装 Chrome/Edge。通过原生 CDP WebSocket 通信（无需 puppeteer）。
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const PORT = 9241;
const PROFILE_DIR = join(tmpdir(), "creen-2api-login-profile");

/* ---------- 查找浏览器 ---------- */

function findBrowser(): string | null {
  const plat = process.platform;
  const candidates: string[] = [];
  if (plat === "win32") {
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] ?? "";
    candidates.push(
      join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
      join(local, "Google\\Chrome\\Application\\chrome.exe"),
      join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
      join(pf86, "Microsoft\\Edge\\Application\\msedge.exe")
    );
  } else if (plat === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge");
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/* ---------- 极简 CDP 客户端 ---------- */

class CDP {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 关键：不发送 Origin 头
      this.ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error("CDP 连接超时")), 10_000);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP 连接失败"));
      };
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      };
    });
  }

  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload: any = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30_000);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

async function getJSON(url: string): Promise<any> {
  const r = await fetch(url);
  return r.json();
}

async function waitForDevTools(port: number, tries = 60): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await getJSON(`http://127.0.0.1:${port}/json/version`);
      if (v?.webSocketDebuggerUrl) return v;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`等待调试端口 ${port} 超时`);
}

/* ---------- 主流程 ---------- */

async function main() {
  const headless = process.argv.includes("--headless");
  const url = "https://www.creen.ai/";

  const browser = findBrowser();
  if (!browser) {
    console.error("✗ 未找到 Chrome/Edge。请安装后重试，或手动填写 token。");
    process.exit(1);
  }
  console.log(`使用浏览器: ${browser}`);
  console.log(`配置文件:   ${PROFILE_DIR}`);

  mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,860",
    ...(headless ? ["--headless=new"] : []),
    url,
  ];

  const proc = spawn(browser, args, { stdio: "ignore", detached: false });
  proc.on("exit", () => {});

  try {
    const ver = await waitForDevTools(PORT);
    const cdp = new CDP();
    await cdp.connect(ver.webSocketDebuggerUrl);

    // 新建标签页并附着
    const tabRes = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const tab = await tabRes.json();
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: tab.id, flatten: true });
    await cdp.send("Runtime.enable", {}, sessionId);

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
        const r = await cdp.send(
          "Runtime.evaluate",
          {
            expression: `JSON.stringify({
              token: localStorage.getItem("x-auth-token"),
              info: localStorage.getItem("x-auth-user")
            })`,
            returnByValue: true,
          },
          sessionId
        );
        const parsed = JSON.parse(r.result?.value ?? "{}");
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
    cdp.close();
    try {
      proc.kill();
    } catch {
      /* ignore */
    }

    if (!token) {
      console.error("✗ 未能提取 token（超时或未登录）。可手动从 DevTools → Application → Local Storage 复制 x-auth-token。");
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
      const check = await fetch("https://www.creen.ai/api/auth/getAccount", {
        headers: {
          "x-auth-token": token,
          "x-platform": "web",
          "x-version": "999.0.0",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          referer: "https://www.creen.ai/",
        },
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
    console.log(`网关会自动读取（重启后生效），或运行:\n  curl -X POST http://127.0.0.1:47840/api/pool/add -H "content-type: application/json" -d '{"token":"${token.slice(0, 16)}..."}'`);
    process.exit(0);
  } catch (e) {
    console.error("✗ 失败:", (e as Error).message);
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

main();
