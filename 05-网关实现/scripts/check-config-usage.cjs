const fs = require("fs");
const path = require("path");

const KEYS = [
  "listen_addr","upstream_base_url","tokens","accounts","email_config","mail_api","default_model",
  "request_timeout_sec","poll_interval_sec","poll_max_attempts","max_concurrent_requests",
  "per_token_concurrent","catalog_refresh_min","rate_limit_enabled","rate_limit_requests",
  "rate_limit_window_sec","retry_enabled","max_attempts","cooldown_map","download_media",
  "media_dir","ui_enabled","redact_logs","gateway_api_key","trust_proxy","allow_insecure_public",
  "auto_renew","token_check_min",
];

// 间接消费映射：配置键 → 负责读取它的函数名
const INDIRECT = {
  cooldown_map: "cooldownFor", // config.ts 解析为 _cooldowns，由 cooldownFor() 暴露
  mail_api: "fromConfig",      // CloudMailClient.fromConfig(cfg) 读取 (cfg as any).mail_api
};

function walk(d) {
  let out = [];
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (f.endsWith(".ts")) out.push(p);
  }
  return out;
}

// 消费点：`cfg.<key>` 的读取。接口声明（`key: type`）与 DEFAULTS（`key: value`）都不带
// `cfg.` 前缀，因此不会误计为消费。config.ts 内部的 validate()/applyEnvOverrides() 是
// 合法消费点（如 allow_insecure_public 的 fail-closed 判定），故一并纳入。
const files = walk("src");
const corpus = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const outsideConfig = files
  .filter((f) => !f.endsWith("config.ts"))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

const dead = [];
for (const k of KEYS) {
  // 直接消费：cfg.k
  const direct = (corpus.match(new RegExp("cfg\\." + k + "\\b", "g")) || []).length;

  // 间接消费：经专用访问器函数读取
  const fn = INDIRECT[k];
  const indirect = fn ? (corpus.match(new RegExp("\\b" + fn + "\\s*\\(", "g")) || []).length : 0;

  // 是否在 config.ts 之外也有消费点（更能说明"被业务逻辑真正使用"）
  const external = (outsideConfig.match(new RegExp("cfg\\." + k + "\\b", "g")) || []).length;

  const n = direct + indirect;
  if (n === 0) dead.push(k);
  const tag = direct > 0 ? (external > 0 ? "OK  " : "OK~ ") : indirect > 0 ? "OK* " : "DEAD";
  const note = direct > 0 && external === 0 ? "  (仅 config.ts 内部消费)" : direct > 0 ? "" : indirect > 0 ? "  (经 " + fn + " 间接消费)" : "";
  console.log(tag + " " + k.padEnd(26) + n + note);
}
console.log("\n未被消费的配置键: " + (dead.length ? dead.join(", ") : "（无）"));
