/**
 * 配置加载
 *  - config.json 为主；config.local.json 可选覆盖（不入库）
 *  - 环境变量 CREEN_CONFIG 可指定路径
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface EmailConfig {
  provider: string;
  api_base: string;
  api_key: string;
  domain: string;
  /** 额外参数（不同邮箱 API 各异） */
  [k: string]: any;
}

export interface AccountCredential {
  email: string;
  password: string;
}

export interface Config {
  listen_addr: string;
  upstream_base_url: string;

  /** 直接提供的 token 列表（x-auth-token 值） */
  tokens: string[];
  /** 账号凭据（配合邮箱 API 自动注册/登录） */
  accounts: AccountCredential[];
  email_config: EmailConfig;

  default_model: number;

  request_timeout_sec: number;
  poll_interval_sec: number;
  poll_max_attempts: number;

  max_concurrent_requests: number;
  per_token_concurrent: number;

  catalog_refresh_min: number;

  rate_limit_enabled: boolean;
  rate_limit_requests: number;
  rate_limit_window_sec: number;

  retry_enabled: boolean;
  max_attempts: number;
  cooldown_map: string;

  download_media: boolean;
  media_dir: string;

  ui_enabled: boolean;
  redact_logs: boolean;

  auto_renew: boolean;
  token_check_min: number;

  /** 运行时：配置文件所在目录 */
  _configDir: string;
}

const DEFAULTS: Omit<Config, "_configDir"> = {
  listen_addr: "127.0.0.1:47840",
  upstream_base_url: "https://www.creen.ai",
  tokens: [],
  accounts: [],
  email_config: { provider: "", api_base: "", api_key: "", domain: "" },
  default_model: 6,
  request_timeout_sec: 180,
  poll_interval_sec: 3,
  poll_max_attempts: 100,
  max_concurrent_requests: 8,
  per_token_concurrent: 2,
  catalog_refresh_min: 60,
  rate_limit_enabled: true,
  rate_limit_requests: 120,
  rate_limit_window_sec: 3600,
  retry_enabled: true,
  max_attempts: 3,
  cooldown_map: "0,15,60,120,300",
  download_media: true,
  media_dir: "data/media",
  ui_enabled: true,
  redact_logs: true,
  auto_renew: true,
  token_check_min: 30,
};

export function loadConfig(): Config {
  const explicit = process.env.CREEN_CONFIG;
  const baseDir = process.cwd();
  const mainPath = explicit ? resolve(explicit) : resolve(baseDir, "config.json");
  const localPath = resolve(baseDir, "config.local.json");

  let cfg: any = {};
  if (existsSync(mainPath)) {
    cfg = JSON.parse(readFileSync(mainPath, "utf8"));
  } else if (existsSync(resolve(baseDir, "config.example.json"))) {
    console.warn(`[config] 未找到 ${mainPath}，回退到 config.example.json（token 为空）`);
    cfg = JSON.parse(readFileSync(resolve(baseDir, "config.example.json"), "utf8"));
  }

  // 局部覆盖
  if (existsSync(localPath)) {
    const local = JSON.parse(readFileSync(localPath, "utf8"));
    cfg = deepMerge(cfg, local);
    console.log(`[config] 已应用局部覆盖 ${localPath}`);
  }

  // 清理注释键（以 // 开头）
  const clean: any = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith("//")) continue;
    clean[k] = v;
  }

  const merged: Config = { ...DEFAULTS, ...clean, _configDir: dirname(mainPath) };

  validate(merged);
  return merged;
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(b)) return b;
  if (b && typeof b === "object") {
    const out = { ...(a ?? {}) };
    for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a?.[k], v);
    return out;
  }
  return b;
}

function validate(cfg: Config) {
  if (!cfg.listen_addr || !/^[\d.]+:\d+$/.test(cfg.listen_addr)) {
    throw new Error(`config.listen_addr 格式错误（应为 host:port）: ${cfg.listen_addr}`);
  }
  if (!/^https?:\/\//.test(cfg.upstream_base_url)) {
    throw new Error(`config.upstream_base_url 必须是 http(s) URL: ${cfg.upstream_base_url}`);
  }
  if (!Array.isArray(cfg.tokens)) cfg.tokens = [];
  if (!Array.isArray(cfg.accounts)) cfg.accounts = [];

  // 解析冷却档位
  const cd = String(cfg.cooldown_map)
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => Number.isFinite(x) && x >= 0);
  if (cd.length === 0) (cfg as any)._cooldowns = [0, 15, 60];
  else (cfg as any)._cooldowns = cd;

  if (cfg.tokens.length === 0 && cfg.accounts.length === 0) {
    console.warn(
      "[config] ⚠ 未配置任何 tokens/accounts —— 仅公开端点可用（模型列表/积分计算），生成功能需登录 token。"
    );
  }
}

/** 冷却档位（按失败次数取） */
export function cooldownFor(cfg: Config, attempt: number): number {
  const arr: number[] = (cfg as any)._cooldowns ?? [0, 15, 60];
  return arr[Math.min(attempt, arr.length - 1)] ?? 0;
}
