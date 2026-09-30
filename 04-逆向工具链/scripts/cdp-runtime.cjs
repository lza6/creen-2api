// 最彻底方案：在页面上下文中读取 webpack runtime 的 chunk 映射表，直接 fetch 全部 chunk
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = path.join(__dirname, "chunks");
fs.mkdirSync(OUT, { recursive: true });

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d))); }).on("error", reject);
  });
}
class CDP {
  constructor(w) { this.w = w; this.id = 0; this.pending = new Map(); }
  connect() { return new Promise((res, rej) => {
    this.ws = new WebSocket(this.w);
    this.ws.onopen = () => res();
    this.ws.onerror = () => rej(new Error("ws"));
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    };
  }); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); }); }
}

(async () => {
  const ver = await getJSON("http://127.0.0.1:9222/json/version");
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.connect();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  console.log("加载站点以获取 webpack runtime...");
  await cdp.send("Page.navigate", { url: "https://www.creen.ai/" }, sessionId);
  await new Promise(r => setTimeout(r, 10000));

  // 在页面执行：枚举 webpackChunk_N_E，读取 r.u（chunk 名解析）与已知 chunk
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      try {
        var chunks = [];
        var wc = self.webpackChunk_N_E;
        // 找 webpack runtime：通过 __webpack_require__ 挂在某个模块上
        // 直接遍历所有已加载 script
        var scripts = [...document.querySelectorAll('script[src*="/_next/static/chunks/"]')];
        scripts.forEach(s => chunks.push(s.src));
        // 尝试从 webpack runtime 拿映射表
        var mapping = null;
        for (var k in self) {
          try {
            var v = self[k];
            if (v && typeof v === 'object' && typeof v.u === 'function') {
              // webpack require
              mapping = {};
              // 遍历猜测的 id（从 runtime 的字符串里提取）
            }
          } catch(e){}
        }
        return JSON.stringify({ scripts: chunks.length, urls: chunks.slice(0,400) });
      } catch(e) { return 'ERR:'+e.message }
    })()`,
    returnByValue: true,
  }, sessionId);

  let urls = [];
  try {
    const data = JSON.parse(result.result.value);
    urls = data.urls || [];
    console.log("页面 script 数:", data.scripts);
  } catch (e) {
    console.log("解析失败:", result.result.value?.slice(0, 200));
  }

  // 直接从 webpack runtime 源码提取 chunk 哈希表
  const rtPath = urls.find(u => u.includes("webpack-"));
  console.log("runtime:", rtPath);
  if (rtPath) {
    const rt = await cdp.send("Runtime.evaluate", {
      expression: `fetch(${JSON.stringify(rtPath)}).then(r=>r.text())`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    const src = rt.result.value || "";
    fs.writeFileSync(path.join(__dirname, "webpack-runtime-live.js"), src);
    console.log("runtime 源码长度:", src.length);
  }

  await cdp.send("Target.closeTarget", { targetId });
  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
