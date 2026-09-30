// 深度抓取：模拟用户交互触发更多懒加载 chunk
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
  constructor(w) { this.w = w; this.id = 0; this.pending = new Map(); this.h = new Map(); }
  connect() { return new Promise((res, rej) => {
    this.ws = new WebSocket(this.w);
    this.ws.onopen = () => res();
    this.ws.onerror = () => rej(new Error("ws"));
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method) for (const fn of (this.h.get(m.method) || [])) fn(m.params, m.sessionId);
    };
  }); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); }); }
  on(m, fn) { if (!this.h.has(m)) this.h.set(m, []); this.h.get(m).push(fn); }
}

const SCENES = [
  // URL, 交互脚本（点击/输入）
  { url: "/create", action: `(async()=>{
      const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
      // 遍历所有可点击元素，触发 Tab 切换
      const clickByText=(txt)=>{const els=[...document.querySelectorAll('button,[role=tab],a')];const el=els.find(e=>(e.textContent||'').trim().includes(txt));if(el){el.click();return true}return false};
      for(const t of ['Video','Audio','Comic','Image','Video Editor','動畫','音訊','漫畫','圖像']){clickByText(t);await sleep(900)}
    })()` },
  { url: "/models", action: `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const els=[...document.querySelectorAll('button,[role=tab],a')];
      for(const e of els.slice(0,25)){try{e.click()}catch(_){}await sleep(250)}})()` },
  { url: "/features", action: `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const links=[...document.querySelectorAll('a[href]')];
      for(const a of links.slice(0,10)){try{a.click()}catch(_){}await sleep(400)}})()` },
  { url: "/features/ai-motion-control", action: `window.scrollTo(0,document.body.scrollHeight)` },
  { url: "/pricing", action: `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const btns=[...document.querySelectorAll('button')];
      for(const b of btns.slice(0,15)){try{b.click()}catch(_){}await sleep(350)}})()` },
  { url: "/explore", action: `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      window.scrollTo(0,document.body.scrollHeight);await sleep(1500);
      const cards=[...document.querySelectorAll('img,[role=button],button')];
      for(const c of cards.slice(0,8)){try{c.click()}catch(_){}await sleep(400)}})()` },
  { url: "/", action: `(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<8;i++){window.scrollTo(0,document.body.scrollHeight*(i+1)/8);await sleep(600)}})()` },
];

(async () => {
  const ver = await getJSON("http://127.0.0.1:9222/json/version");
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.connect();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  const seen = new Set(fs.existsSync(OUT) ? fs.readdirSync(OUT).map(f => f.replace(/^[^.]*\./, m => m)) : []);
  const existing = new Set(fs.readdirSync(OUT));
  let newCount = 0;

  cdp.on("Network.responseReceived", async (p) => {
    const url = p.response.url;
    if (!url.includes("/_next/static/")) return;
    const name = url.split("/").pop().split("?")[0];
    if (existing.has(name)) return;
    if (!/\.(js|css)$/.test(name)) return;
    existing.add(name);
    try {
      const body = await cdp.send("Network.getResponseBody", { requestId: p.requestId }, sessionId);
      const buf = body.base64Encoded ? Buffer.from(body.body, "base64") : Buffer.from(body.body, "utf8");
      fs.writeFileSync(path.join(OUT, name), buf);
      newCount++;
      process.stdout.write(`  + ${name} (${buf.length}B)\n`);
    } catch (e) {}
  });

  await cdp.send("Network.enable", { maxResourceBufferSize: 400 * 1024 * 1024, maxTotalBufferSize: 1024 * 1024 * 1024 }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  for (const { url, action } of SCENES) {
    console.log(`\n=== ${url} ===`);
    try {
      await cdp.send("Page.navigate", { url: "https://www.creen.ai" + url }, sessionId);
      await new Promise(r => setTimeout(r, 5000));
      await cdp.send("Runtime.evaluate", { expression: action, awaitPromise: true }, sessionId);
      await new Promise(r => setTimeout(r, 4000));
      const t = await cdp.send("Runtime.evaluate", { expression: "location.pathname + ' | ' + document.title.slice(0,40)" }, sessionId);
      console.log("  当前:", t.result.value);
    } catch (e) { console.log("  错误:", e.message.slice(0, 80)); }
  }

  console.log(`\n新增 ${newCount} 个资源`);
  await cdp.send("Target.closeTarget", { targetId });
  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
