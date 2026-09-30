// 系统抓取：遍历所有路由 + 触发懒加载，收集全部 chunk
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = path.join(__dirname, "chunks");
fs.mkdirSync(OUT, { recursive: true });

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.handlers = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("ws error"));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else if (msg.method) {
          for (const h of (this.handlers.get(msg.method) || [])) h(msg.params, msg.sessionId);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
}

const ROUTES = [
  "/", "/create", "/explore", "/models", "/features",
  "/features/ai-motion-control", "/pricing", "/my-assets",
  "/profile", "/subscriptions", "/about-us", "/contact-us",
  "/faqs", "/refund-policy", "/privacy", "/terms",
  "/create/1", "/regenerate",
];

(async () => {
  const ver = await getJSON("http://127.0.0.1:9222/json/version");
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.connect();

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  const seen = new Set();
  const saved = [];
  const failed = [];

  cdp.on("Network.responseReceived", async (p) => {
    const url = p.response.url;
    if (!url.includes("/_next/static/") || seen.has(url)) return;
    seen.add(url);
    const name = url.split("/").pop().split("?")[0];
    if (!/\.(js|css)$/.test(name)) return;
    try {
      const body = await cdp.send("Network.getResponseBody", { requestId: p.requestId }, sessionId);
      const buf = body.base64Encoded ? Buffer.from(body.body, "base64") : Buffer.from(body.body, "utf8");
      fs.writeFileSync(path.join(OUT, name), buf);
      saved.push(name);
    } catch (e) { failed.push(name); }
  });

  await cdp.send("Network.enable", { maxResourceBufferSize: 300 * 1024 * 1024, maxTotalBufferSize: 800 * 1024 * 1024 }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  for (const route of ROUTES) {
    const url = "https://www.creen.ai" + route;
    process.stdout.write(`\n=== ${route} ===\n`);
    try {
      await cdp.send("Page.navigate", { url }, sessionId);
      await new Promise((r) => setTimeout(r, 6000));
      // 滚动触发懒加载
      for (let i = 0; i < 3; i++) {
        await cdp.send("Runtime.evaluate", {
          expression: `(function(){const h=document.body.scrollHeight;window.scrollTo(0,h*${(i+1)/3});})()`,
        }, sessionId);
        await new Promise((r) => setTimeout(r, 1200));
      }
      const t = await cdp.send("Runtime.evaluate", { expression: "document.title" }, sessionId);
      console.log("  标题:", String(t.result.value).slice(0, 60));
    } catch (e) {
      console.log("  错误:", e.message.slice(0, 100));
    }
  }

  fs.writeFileSync(path.join(__dirname, "saved-all.json"), JSON.stringify({ saved, failed }, null, 2));
  console.log(`\n共保存 ${saved.length} 个资源，失败 ${failed.length} 个`);

  await cdp.send("Target.closeTarget", { targetId });
  process.exit(0);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
