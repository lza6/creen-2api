/**
 * Web 管理面板（单页，零依赖）
 *  - 模型列表 / 账号池状态 / 实时日志
 */

import type { ApiContext } from "../api/openai";

export async function startWeb(ctx: ApiContext): Promise<Response> {
  return new Response(PANEL_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const PANEL_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Creen-2API 控制台</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;--accent:#2f81f7;--green:#3fb950;--red:#f85149;--amber:#d29922;--purple:#a371f7}
body{background:var(--bg);color:var(--text);font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:20px}
h1{font-size:18px;margin-bottom:4px}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px}
.card .v{font-size:22px;font-weight:600;color:var(--accent);font-family:ui-monospace,Consolas,monospace}
.card .l{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px}
section{margin-bottom:22px}
h2{font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden}
th{background:#1c2333;padding:8px 10px;text-align:left;font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px}
td{padding:7px 10px;border-top:1px solid var(--border);font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
tr:hover td{background:#1c2333}
.badge{padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600}
.b-active{background:rgba(63,185,80,.15);color:var(--green)}
.b-cooldown{background:rgba(210,153,34,.15);color:var(--amber)}
.b-invalid{background:rgba(248,81,73,.15);color:var(--red)}
.b-exhausted{background:rgba(163,113,247,.15);color:var(--purple)}
.k-img{color:var(--accent)}.k-video{color:var(--purple)}
button{background:#21262d;border:1px solid var(--border);color:var(--text);padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;margin-right:8px}
button:hover{background:#30363d;border-color:var(--dim)}
button.p{background:#1f6feb;border-color:var(--accent);color:#fff}
pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dim);overflow:auto;max-height:300px;white-space:pre-wrap}
code{background:#21262d;padding:1px 5px;border-radius:4px;font-size:11.5px}
</style>
</head>
<body>
<h1>Creen-2API 控制台</h1>
<div class="sub">Creen (creen.ai) 图像/视频生成 → OpenAI 兼容网关</div>

<div class="grid" id="stats"></div>

<div style="margin-bottom:20px">
  <button class="p" onclick="refreshCatalog()">刷新模型目录</button>
  <button onclick="refreshPool()">刷新账号积分</button>
  <button onclick="load()">重新载入</button>
</div>

<section>
  <h2>账号池</h2>
  <table id="poolTable"><thead><tr><th>Token</th><th>邮箱</th><th>积分</th><th>状态</th><th>并发</th><th>已用</th></tr></thead><tbody></tbody></table>
</section>

<section>
  <h2>模型（<span id="modelCount">0</span>）</h2>
  <table id="modelTable"><thead><tr><th>名称</th><th>类型</th><th>上游 ID</th><th>积分</th><th>VIP</th></tr></thead><tbody></tbody></table>
</section>

<section>
  <h2>用法</h2>
  <pre># OpenAI SDK
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:47840/v1", api_key="sk-local")
resp = client.images.generate(model="nano-banana-pro", prompt="a cat", n=1)
print(resp.data[0].url)

# curl
curl -X POST http://127.0.0.1:47840/v1/images/generations \\
  -H "content-type: application/json" \\
  -d '{"model":"nano-banana-pro","prompt":"a cyberpunk cat"}'</pre>
</section>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function load() {
  try {
    const st = await (await fetch("/api/status")).json();
    const pool = st.pool || [];
    $("#stats").innerHTML = [
      ["模型总数", st.catalog?.count ?? 0],
      ["Token 数", pool.length],
      ["可用 Token", pool.filter(t => t.status === "active").length],
      ["总积分", pool.reduce((s, t) => s + (t.integral ?? 0), 0).toLocaleString()],
    ].map(([l, v]) => \`<div class="card"><div class="v">\${esc(v)}</div><div class="l">\${l}</div></div>\`).join("");

    $("#poolTable tbody").innerHTML = pool.length
      ? pool.map(t => \`<tr>
          <td>\${esc(t.token)}</td><td>\${esc(t.email ?? "-")}</td>
          <td>\${t.integral ?? "?"}</td>
          <td><span class="badge b-\${esc(t.status)}">\${esc(t.status)}</span></td>
          <td>\${t.inflight}</td><td>\${t.usedCount}</td>
        </tr>\`).join("")
      : '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:16px">未配置 token（config.json 的 tokens）</td></tr>';

    const models = await (await fetch("/v1/models")).json();
    $("#modelCount").textContent = models.data.length;
    $("#modelTable tbody").innerHTML = models.data.map(m => \`<tr>
        <td>\${esc(m.id)}</td>
        <td class="k-\${esc(m._kind)}">\${esc(m._kind)}</td>
        <td>\${m._upstream_id}</td>
        <td>\${m._integral_fee}</td>
        <td>\${m._vip_level || "-"}</td>
      </tr>\`).join("");
  } catch (e) {
    console.error(e);
  }
}
async function refreshCatalog() { await fetch("/api/catalog/refresh", { method: "POST" }); load(); }
async function refreshPool() { await fetch("/api/pool/refresh", { method: "POST" }); load(); }
load();
setInterval(load, 15000);
</script>
</body>
</html>`;
