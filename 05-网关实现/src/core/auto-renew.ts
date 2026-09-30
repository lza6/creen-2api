/**
 * 自动续期
 *  - 定时校验所有 token 有效性
 *  - 失效的 token：用 accounts 里的凭据重新登录
 *  - 登录也失败：若配置了邮箱 API，则自动注册新账号
 */

import type { Config } from "./config";
import type { AccountPool } from "./account-pool";
import type { AuthService } from "./auth";

export interface AutoRenewDeps {
  cfg: Config;
  pool: AccountPool;
  auth: AuthService;
}

export function startAutoRenew(deps: AutoRenewDeps) {
  const { cfg, pool, auth } = deps;
  const intervalMin = Math.max(5, cfg.token_check_min || 30);

  const tick = async () => {
    if (pool.size === 0) return;

    // 1) 刷新积分（同时发现失效 token）
    await pool.refreshIntegrals();

    // 2) 对失效 token 尝试续期
    const snap = pool.snapshot();
    const invalid = snap.filter((t) => t.status === "invalid");
    if (invalid.length === 0) return;

    console.log(`[auto-renew] 发现 ${invalid.length} 个失效 token，尝试续期…`);

    for (const item of invalid) {
      const cred = cfg.accounts.find((a) => a.email && item.email && a.email === item.email);
      if (!cred) {
        console.warn(`[auto-renew] ${item.email ?? item.token} 无对应凭据，跳过`);
        continue;
      }
      try {
        const r = await auth.renew({ email: cred.email, password: cred.password });
        // 旧 token 失效 → 用新 token 替换
        pool.remove(item.token);
        pool.add(r.token, cred.email, "auto-renewed");
        console.log(`[auto-renew] ✓ ${cred.email} 续期成功`);
      } catch (e) {
        console.warn(`[auto-renew] ✗ ${cred.email} 续期失败: ${(e as Error).message}`);
      }
    }
    pool.save();
  };

  // 首次延迟 60s（避开启动时的一次性刷新）
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), intervalMin * 60_000).unref?.();

  console.log(`[auto-renew] 已启用（每 ${intervalMin} 分钟检查一次）`);
}
