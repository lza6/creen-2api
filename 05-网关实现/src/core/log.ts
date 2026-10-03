/**
 * 日志脱敏
 *  - 对应 config.redact_logs
 *  - 在日志输出前遮蔽 token / api_key / authorization 等敏感值
 */

import type { Config } from "./config";

const TOKEN_KEYS = /(token|api[_-]?key|authorization|password|secret|turnstile)/i;
const JWT_LIKE = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const LONG_SECRET = /\b[A-Za-z0-9_-]{32,}\b/g;

/** 遮蔽单个字符串中的疑似密钥 */
export function redactString(s: string): string {
  return s.replace(JWT_LIKE, "***REDACTED***").replace(LONG_SECRET, "***REDACTED***");
}

/** 深拷贝并遮蔽对象中的敏感字段 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = TOKEN_KEYS.test(k) ? "***REDACTED***" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** 依据配置决定是否脱敏 */
export function maybeRedact(value: unknown, cfg: Config): unknown {
  return cfg.redact_logs ? redactValue(value) : value;
}

/** 便捷：脱敏后的 JSON 字符串 */
export function redactJson(value: unknown, cfg: Config): string {
  try {
    return JSON.stringify(maybeRedact(value, cfg));
  } catch {
    return "[unserializable]";
  }
}
