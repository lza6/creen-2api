// 利用浏览器会话，从页面内 fetch 全部 webpack chunk（含未下载的 45 个）
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
    this.ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  }); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); }); }
}

// 硬编码 fallback 映射（来自 webpack-6e1c1d4c1a763d2b.js）
const HASH_MAP = {
  233:"f9330b0ac5c295e7",379:"4f6a8bb9273bc3c5",1117:"20745405196b7b48",1298:"4c8574ca02fb7b72",
  1804:"0c38b3887cd449ea",1902:"30d97160c45c7678",2566:"c99da3a99cd50c6f",2708:"18898942baa54f8f",
  2856:"6a99a3a9cd38d492",2888:"f8d4ce7bac87ddc4",3187:"3860ba081ad09b86",3269:"44f864a0d92c1926",
  3359:"34ee58c631156cff",3564:"061f5c6ab43576a6",3669:"42dce5fc3363d9c4",4039:"6b1f3cee3cdb544d",
  4050:"780cd9d7f432e51d",4290:"aee63ad53124d3c5",4308:"bdf510238f9ce8f2",4525:"b2adde9d4a78fb76",
  4568:"5718ba6eed7b1992",5060:"c33435631be88ead",5080:"b90f3ba654855b84",5142:"8cc95d675e4959d0",
  5221:"c7bf20bac71dfa5e",5615:"4547c875da2ffab9",5880:"fcaa53102c5c5fc8",6020:"ccc6f44951ab387b",
  6329:"7765d894ce4a6f42",6370:"e0c4c71ffaef3cb0",6508:"eac67b226f071b0e",6861:"f2b7cc5241c87f42",
  6931:"671268355d26708d",6974:"5f9dc92a56c03dfc",6990:"c3c4688aa7aa8b66",7144:"0524a77557d1fad7",
  7150:"f9e0da358f70ab77",7202:"8c19f7e36fb5740e",7371:"d5005e04cc08017d",7978:"5a5d7ae3c080b813",
  8292:"cd413353561546fe",8412:"6c7c693db3e37c0c",8459:"7de5e59c00041ce2",8562:"8f2cb70f1b4000d5",
  8847:"78679756143ad6db",8892:"8811a0799fdd64de",8997:"39ce4ee6b9ddd2d4",9011:"176bad87467eb6e2",
  9045:"c90fb96d715b7e9f",9441:"31b124b64297539d",9496:"ff096076e39345f3",9625:"f437b9c77d2987c3",
  9690:"c52e528df7affe75",9758:"8369276c1f2e04de",
};

(async () => {
  const ver = await getJSON("http://127.0.0.1:9222/json/version");
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.connect();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  console.log("建立会话...");
  await cdp.send("Page.navigate", { url: "https://www.creen.ai/" }, sessionId);
  await new Promise(r => setTimeout(r, 8000));

  // 在页面内批量 fetch（同源，携带 CF cookie）
  const expr = `(async function(){
    const base = "/_next/static/chunks/";
    const map = ${JSON.stringify(HASH_MAP)};
    const out = {};
    const ids = Object.keys(map);
    for (const id of ids) {
      const url = base + id + "." + map[id] + ".js";
      try {
        const r = await fetch(url);
        if (r.ok) { out[url] = await r.text(); }
      } catch(e) {}
    }
    return JSON.stringify(out);
  })()`;

  console.log("页面内批量下载 " + Object.keys(HASH_MAP).length + " 个 chunk...");
  const res = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  let saved = 0;
  try {
    const data = JSON.parse(res.result.value);
    for (const [url, content] of Object.entries(data)) {
      const name = url.split("/").pop();
      fs.writeFileSync(path.join(OUT, name), content);
      saved++;
      console.log("  + " + name + " (" + content.length + "B)");
    }
  } catch (e) { console.log("解析失败:", String(res.result.value).slice(0, 300)); }

  console.log("\n下载 " + saved + " 个 chunk");
  await cdp.send("Target.closeTarget", { targetId });
  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
