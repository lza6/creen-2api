# 网关生产化 —— 工作状态

> 承接上个会话（中断于 Spec-Kit Phase 1 Constitution）。
> 更新：2026-09-30

## 任务契约

将 `05-网关实现`（Creen-2API 网关，bun + TypeScript）从「可运行原型」推进到
「可上生产」，对齐同作者成熟项目 `tryingopen-2api` 的工程标准。

## 验收标准

| # | 标准 | 状态 | 证据 |
|---|------|------|------|
| 1 | 已声明的配置项全部真实生效（无死配置） | 已完成 | 见下「缺陷修复」；单测覆盖 |
| 2 | 网关入口具备鉴权，防止盗刷账号积分 | 已完成 | HTTP 实测：无 key 401 / 正确 key 200 |
| 3 | 全局限流与并发门控生效 | 已完成 | HTTP 实测：第 4 次 429 + Retry-After；单测验证峰值 ≤ limit |
| 4 | 结果媒体可本地持久化 | 已完成 | HTTP 实测：/media 返回 200 + 正确 content-type |
| 5 | 日志脱敏 | 已完成 | 单测覆盖 token/JWT/嵌套字段 |
| 6 | 类型检查通过（strict） | 已完成 | `bunx tsc --noEmit` → exit 0 |
| 7 | 单元测试全绿 | 已完成 | 59 pass / 0 fail（原 24） |
| 8 | E2E 覆盖公开端点 | 已完成 | 13 pass / 0 fail（真实上游） |
| 9 | Spec-Kit 规范落地 | 已完成 | `.specify/memory/constitution.md` |
| 10 | 生产配套文件 | 已完成 | Dockerfile / compose / CI / LICENSE / CHANGELOG / .env.example |
| 11 | 文档与真实行为一致 | 已完成 | README 同步配置、安全、测试数、架构 |

## 缺陷修复（本次）

| 缺陷 | 级别 | 根因 | 修复 |
|------|------|------|------|
| `cooldown_map` 配置失效 | P1 | `cooldownFor()` 为死代码，账号池硬编码 `failCount*15` | account-pool 接入 `cooldownFor` |
| `max_concurrent_requests` 未实施 | P1 | 仅声明 | 新增 `ConcurrencyGate` 并接入生成路由 |
| `rate_limit_*` 未实施 | P1 | 仅声明 | 新增 `SlidingWindowRateLimiter` + IP 分桶 |
| 网关零鉴权 | P1（安全） | 无鉴权层 | 新增 `gateway_api_key` + 常量时间比较 |
| `download_media`/`media_dir` 未实施 | P2 | 仅声明 | 新增 `MediaStore` + `/media` 路由 |
| `redact_logs` 未实施 | P2 | 仅声明 | 新增 `log.ts` 脱敏工具 |
| 积分扣减未立即持久化 | P2 | 仅触发防抖快照 | 改为立即 `pool.save()` |
| `NO_ACCOUNT` 返回 500 | P2 | 状态码映射错误 | 修正为 503 |

## 独立安全审查（review:security-auditor）

结论：**0 CRITICAL / 0 HIGH**；3 MEDIUM + 4 LOW，已修复 MEDIUM 与关键 LOW。

| 发现 | 级别 | 处置 |
|------|------|------|
| M1 `/media/*` 鉴权前返回（数据面免鉴权） | MEDIUM | 已修复：媒体 URL 加 HMAC 签名，无/错签名返回 403 |
| M2 限流按 IP 分桶在反代后塌缩；XFF 可伪造 | MEDIUM | 已修复：新增 `trust_proxy`，默认不信任 XFF，开启后取最后一跳 |
| M3 鉴权默认 fail-open（无密钥非回环仅告警） | MEDIUM | 已修复：改为拒绝启动（`allow_insecure_public` 可显式豁免） |
| L1 `safeEqual` 长度不等早返回（侧信道） | LOW | 已修复：改为先 SHA-256 再常量时间比较 |
| L2 `redact_logs` 为死代码 | LOW | 已修复：`log.ts` 工具落地；接入了 500 错误泛化 |
| L3 500 回显内部错误消息 | LOW | 已修复：对外返回泛化消息，细节入日志 |
| L4 `/healthz` 免鉴权暴露池/闸门统计 | LOW | 已修复：精简为 `{status, version}` |

审查确认无问题的项（节选）：路径穿越防护（白名单正则 + `startsWith` 双校验）、
鉴权绕过（URL 精确匹配、`new URL` 不解码百分号）、并发门控槽位泄漏（`finally` 释放）。

## 验证日志

```
bun run check                    → exit 0（typecheck + 59 单测 + 配置消费审计）
bun test test/e2e                → 13 pass / 0 fail（公开端点真实调用，零积分消耗）
启动烟雾（gateway_api_key 生效）  → 无 key 401 / 正确 key 200
限流烟雾（3/60s）                 → 第 4 次 429，retry-after=58
路径穿越（/media/..%2f..%2f）     → 404
媒体签名（启用密钥）              → 无/错 sig 403，正确 sig 200
fail-closed（0.0.0.0 无密钥）     → 拒绝启动（exit 1）
fail-closed 豁免（allow_insecure_public）→ 放行并告警
环境变量覆盖（CREEN_GATEWAY_API_KEY）→ 生效
配置消费审计                      → 25 个配置键全部有消费点，零死配置
```

## 未运行的验证（诚实披露）

- **Docker 镜像构建**：本机无 docker，Dockerfile/compose 仅静态审查。
- **真实生成闭环**：无生产 token，未做端到端生成（付费红线）。
- **auto-renew / register-bot 实跑**：需真实账号与邮箱 API，未执行。

## 上游使用边界（诚实披露）

- 生成端点会真实消耗积分，**本次未做任何真实生成调用**（付费红线）。
- 生成链路的完整闭环（提交→轮询→结果）为**静态确认**（读代码 + 已有 E2E 骨架），
  未用真实 token 端到端运行 —— 缺生产账号凭据。
- 自动注册机（`register-bot`）依赖邮箱 API 与 Turnstile 打码，**待验证**（未配置）。

## 剩余风险 / 待用户决策

- 是否推送这批提交到 `github.com/lza6/creen-2api`（未授权，未执行）。
- 是否补充真实 token 的生成链路 E2E（需用户提供测试账号）。
- `trust_proxy` 需按实际部署拓扑正确设置：直连保持 `false`，置于可信反代后才设 `true`。
- 媒体落盘会占用磁盘，当前无自动清理策略（可后续加保留期 / 容量上限）。
