// CDP 客户端：连接 Chrome，导航站点，抓取全部 JS chunk
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
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("ws error: " + e.message));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else if (msg.method) {
          const hs = this.handlers.get(msg.method) || [];
          for (const h of hs) h(msg.params, msg.sessionId);
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

(async () => {
  const ver = await getJSON("http://127.0.0.1:9222/json/version");
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.connect();

  // 创建新页面 target
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  const seen = new Set();
  const saved = [];

  cdp.on("Network.responseReceived", async (p) => {
    const url = p.response.url;
    if (!url.includes("/_next/static/")) return;
    if (seen.has(url)) return;
    seen.add(url);
    const ext = url.split("?")[0].split(".").pop();
    if (!["js", "css"].includes(ext)) return;
    try {
      const body = await cdp.send("Network.getResponseBody", { requestId: p.requestId }, sessionId);
      const name = url.split("/").pop().split("?")[0];
      const buf = body.base64Encoded ? Buffer.from(body.body, "base64") : Buffer.from(body.body, "utf8");
      fs.writeFileSync(path.join(OUT, name), buf);
      saved.push({ name, size: buf.length });
      process.stdout.write(`  [${saved.length}] ${name} (${buf.length}B)\n`);
    } catch (e) {
      // body 可能已释放
    }
  });

  await cdp.send("Network.enable", { maxResourceBufferSize: 200 * 1024 * 1024, maxTotalBufferSize: 500 * 1024 * 1024 }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  const target = process.argv[2] || "https://www.creen.ai/";
  console.log("导航到:", target);
  await cdp.send("Page.navigate", { url: target }, sessionId);

  // 等待加载 + 让懒加载 chunk 触发
  await new Promise((r) => setTimeout(r, 15000));

  // 滚动触发懒加载
  for (let i = 0; i < 6; i++) {
    await cdp.send("Runtime.evaluate", {
      expression: `window.scrollTo(0, document.body.scrollHeight * ${(i + 1) / 6});`,
    }, sessionId);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const title = await cdp.send("Runtime.evaluate", { expression: "document.title" }, sessionId);
  const html = await cdp.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML.length" }, sessionId);
  console.log("页面标题:", title.result.value, "| HTML 长度:", html.result.value);

  // 保存页面 HTML
  const fullHtml = await cdp.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML" }, sessionId);
  fs.writeFileSync(path.join(__dirname, "page.html"), fullHtml.result.value);

  fs.writeFileSync(path.join(__dirname, "saved.json"), JSON.stringify(saved, null, 2));
  console.log(`\n共保存 ${saved.length} 个资源到 chunks/`);

  await cdp.send("Target.closeTarget", { targetId });
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
