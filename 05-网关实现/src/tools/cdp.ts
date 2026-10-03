/**
 * 极简 CDP 浏览器控制（无 puppeteer 依赖）
 * 供 login-helper / register-helper 复用。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/* ---------- 查找浏览器 ---------- */

export function findBrowser(): string | null {
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

/* ---------- CDP 客户端 ---------- */

export class CDP {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url); // 不发送 Origin 头
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

  /** 在页面上下文求值 */
  async evaluate<T = any>(expression: string, sessionId: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "页面求值异常");
    return r?.result?.value as T;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/* ---------- 启动浏览器并附着标签页 ---------- */

export interface LaunchedBrowser {
  proc: ChildProcess;
  cdp: CDP;
  sessionId: string;
  close: () => void;
}

export async function launchBrowser(opts: {
  url: string;
  port: number;
  profileDir: string;
  headless?: boolean;
  windowSize?: string;
}): Promise<LaunchedBrowser> {
  const browser = findBrowser();
  if (!browser) throw new Error("未找到 Chrome/Edge，请安装后重试");

  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    `--window-size=${opts.windowSize ?? "1280,900"}`,
    ...(opts.headless ? ["--headless=new"] : []),
    opts.url,
  ];

  const proc = spawn(browser, args, { stdio: "ignore", detached: false });
  const ver = await waitForDevTools(opts.port);
  const cdp = new CDP();
  await cdp.connect(ver.webSocketDebuggerUrl);

  const tabRes = await fetch(`http://127.0.0.1:${opts.port}/json/new?${encodeURIComponent(opts.url)}`, {
    method: "PUT",
  });
  const tab = await tabRes.json();
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: tab.id, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);

  const close = () => {
    try {
      cdp.close();
    } catch {
      /* ignore */
    }
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };

  return { proc, cdp, sessionId, close };
}

async function waitForDevTools(port: number, tries = 60): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const v: any = await r.json();
      if (v?.webSocketDebuggerUrl) return v;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`等待调试端口 ${port} 超时`);
}
