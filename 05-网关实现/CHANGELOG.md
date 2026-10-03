# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **网关入口鉴权**：`gateway_api_key` 配置 + `CREEN_GATEWAY_API_KEY` 环境变量；支持
  `Authorization: Bearer` 与 `x-api-key`，常量时间比较，`/healthz` 与 `/ui` 外壳豁免。
  非本机监听且未配置密钥时启动告警。
- **全局限流**：`rate_limit_enabled` / `rate_limit_requests` / `rate_limit_window_sec` 生效，
  滑动窗口按客户端 IP 分桶，超限返回 429 + `Retry-After`（仅生成类端点，管理端点不限）。
- **全局并发门控**：`max_concurrent_requests` 生效，超额请求 FIFO 排队，异常亦释放槽位。
- **媒体本地化**：`download_media` / `media_dir` 生效，生成结果落盘并返回稳定的本地 URL，
  经 `/media/<file>` 提供（带路径穿越防护与长缓存头）。
- **日志脱敏**：`redact_logs` 生效，遮蔽 token / api_key / authorization / JWT 等敏感值。
- **环境变量覆盖**：`CREEN_GATEWAY_API_KEY`、`CREEN_TOKENS`、`CREEN_LISTEN_ADDR`、
  `CREEN_UPSTREAM_BASE_URL`（密钥可不必落盘到 config.json）。
- 项目生产化配套：`tsconfig.json`（strict 类型检查）、`Dockerfile`、
  `docker-compose.yml`、`.dockerignore`、`.env.example`、`LICENSE`、CI 工作流。
- Spec-Kit 规范：`.specify/memory/constitution.md`。
- 测试：新增中间件测试（并发门控 / 限流 / 鉴权 / IP 提取 / 日志脱敏）、媒体签名测试
  与账号池冷却测试，单元测试由 24 项增至 59 项。

### Fixed
- **`cooldown_map` 配置失效**：`cooldownFor()` 此前为死代码，账号池硬编码 `failCount*15` 冷却。
  现已接入，冷却档位真正由配置驱动。
- 生成成功后积分扣减未立即持久化（仅触发防抖快照），现改为立即 `save()`。
- `NO_ACCOUNT` 错误 HTTP 状态由 500 修正为 503（语义为服务未就绪）。

### Security
- 网关此前对任何可达端口开放，会无条件消耗账号积分。现要求非本机部署必须配置密钥。
- **鉴权 fail-closed**：非回环监听且未配置 `gateway_api_key` 时**拒绝启动**
  （可用 `allow_insecure_public: true` 显式豁免）。
- **媒体访问签名**：`/media/<file>` 增加 HMAC 签名校验（密钥源自 `gateway_api_key`），
  防止媒体 URL 泄露后被无鉴权下载；未配置密钥时退回文件名不可枚举。
- **限流分桶防伪造**：新增 `trust_proxy`，默认不信任 `x-forwarded-for`（用 socket 地址）；
  开启后取 XFF **最后一跳**，避免客户端伪造首段绕过限流。
- **常量时间比较加固**：`safeEqual` 改为「先 SHA-256 再比较」，消除长度不等早返回的侧信道。
- 修正 500 响应回显内部/上游错误消息（改为泛化提示，细节仅入服务端日志）。
- `/healthz` 精简为仅 `{status, version}`，避免免鉴权泄露账号/模型数量等侦察信息。

## [0.1.0] - 2026-09-30

### Added
- 首个版本：将 creen.ai 的图像/视频生成逆向为 OpenAI 兼容 API 网关。
- 端点：`/v1/models`、`/v1/images/generations`、`/v1/videos/generations`、
  `/v1/chat/completions`、`/healthz`、`/api/status` 及管理 API、Web 控制台。
- 账号池：轮换 / 冷却 / 积分优选 / 持久化 / 自动续期。
- 内置 57 个模型快照，支持从上游动态刷新合并。
- 工具：`doctor`（诊断）、`login-helper`（提取 token）、`register-bot`（自动注册）。
- 仅支持 bun 运行时（Node 会因 TLS 指纹被 Cloudflare 拦截）。

[Unreleased]: https://github.com/lza6/creen-2api/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lza6/creen-2api/releases/tag/v0.1.0
