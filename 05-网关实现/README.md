# Creen-2API 网关

把 [creen.ai](https://www.creen.ai) 的 AI 图像/视频生成能力，封装为本地 **OpenAI 兼容 API**。

| 项 | 值 |
|----|-----|
| 运行时 | **bun ≥ 1.1**（必须！见下方说明） |
| 依赖 | **零**（bun 内置 HTTP 服务器 + fetch） |
| 模型 | 60 个（图像 20 / 视频 37 / 对口型 3 / 动作 5 / 漫画 3） |
| 默认端口 | `47840` |

> ⚠️ **必须用 bun 运行**：Node 原生 `https`/`http2` 的 TLS 指纹会被 Cloudflare 拦截（403）。
> bun 的内置 TLS 栈可正常通过。网关启动时会自动检测并在误用时给出提示。

---

## 快速开始

```bash
cd 05-网关实现
npm install                      # 仅装 @types/bun（类型提示）
cp config.example.json config.json

# 【必做】填入你的 token（见「获取 Token」）
#   编辑 config.json → "tokens": ["你的 x-auth-token"]

bun run src/tools/doctor.ts      # 诊断环境与连通性
bun run src/index.ts             # 启动网关
```

启动后：
- 控制台面板 http://127.0.0.1:47840/ui
- OpenAI 端点 http://127.0.0.1:47840/v1

---

## 获取 Token

生成端点需登录（游客登录已被上游关闭）。两种方式：

### 方式 A：手动复制（最快）

1. 浏览器登录 https://www.creen.ai
2. F12 → Application → Local Storage → `https://www.creen.ai`
3. 复制 `x-auth-token` 的值
4. 填入 `config.json` 的 `tokens` 数组

### 方式 B：自动提取（推荐）

```bash
bun run src/tools/login-helper.ts
```

会打开浏览器让你登录，登录成功后自动提取 token 写入 `data/accounts.json` 并校验有效性。

### 方式 C：自动注册（需邮箱 API）

```bash
bun run src/tools/register-bot.ts --dry-run   # 先检查配置
bun run src/tools/register-bot.ts --count 5   # 注册 5 个
```

**需先在 `config.json` 配置 `email_config`**（邮箱服务商 API）。框架已就绪，接入后即可批量注册。

---

## 用法

### OpenAI SDK（Python）

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:47840/v1", api_key="sk-local")

# 图像生成
resp = client.images.generate(model="nano-banana-pro", prompt="a cyberpunk cat", n=1)
print(resp.data[0].url)

# 视频生成（扩展端点）
```

### curl

```bash
# 列举模型
curl http://127.0.0.1:47840/v1/models

# 图像生成
curl -X POST http://127.0.0.1:47840/v1/images/generations \
  -H "content-type: application/json" \
  -d '{"model":"nano-banana-pro","prompt":"a cyberpunk cat","n":1}'

# 视频生成
curl -X POST http://127.0.0.1:47840/v1/videos/generations \
  -H "content-type: application/json" \
  -d '{"model":"sora-2","prompt":"a cat running","duration":5}'
```

---

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 模型列表（OpenAI 格式 + 扩展字段） |
| `/v1/images/generations` | POST | 图像生成 |
| `/v1/videos/generations` | POST | 视频生成（扩展） |
| `/v1/chat/completions` | POST | 兼容包装（内容为 markdown 图片） |
| `/healthz` | GET | 健康检查 |
| `/api/status` | GET | 账号池与目录状态 |
| `/api/pool/refresh` | POST | 刷新账号积分 |
| `/api/pool/add` | POST | 动态添加 token |
| `/api/catalog/refresh` | POST | 刷新模型目录 |
| `/ui` | GET | Web 控制台 |

### 请求参数（`/v1/images/generations`）

| 参数 | 类型 | 说明 |
|------|------|------|
| `model` | string | 模型名（见 `/v1/models`）或数字 ID |
| `prompt` | string | 提示词（必填） |
| `n` | number | 数量 1-4（默认 1） |
| `size` | string | 如 `1024x1024`（会映射为分辨率+宽高比） |
| `quality` | string | 画质（如 `1K`/`2K`） |
| `response_format` | string | `url`（默认）或 `b64_json` |
| `image` | string\|string[] | **扩展**：参考图 URL（图生图） |
| `aspect_ratio` | string | **扩展**：`16:9`/`9:16`/`1:1` 等 |

---

## 配置说明

```jsonc
{
  "listen_addr": "127.0.0.1:47840",
  "upstream_base_url": "https://www.creen.ai",

  // 账号：二选一或都填
  "tokens": ["eyJhbGci..."],                    // 直接填 x-auth-token
  "accounts": [{ "email": "...", "password": "..." }],  // 配合 email_config 自动续期

  "email_config": {                              // 注册机邮箱 API（可选）
    "provider": "generic_http",
    "api_base": "https://your-mail-api.example.com",
    "api_key": "YOUR_KEY",
    "domain": ""
  },

  "default_model": 6,          // 默认模型
  "request_timeout_sec": 180,
  "poll_interval_sec": 3,      // 任务轮询间隔
  "poll_max_attempts": 100,    // 轮询上限（3×100=300秒）

  "max_concurrent_requests": 8,
  "per_token_concurrent": 2,   // 单 token 并发上限

  "auto_renew": true,          // token 失效自动重新登录
  "token_check_min": 30,       // 检查间隔（分钟）

  "retry_enabled": true,
  "max_attempts": 3,           // 失败换号重试次数

  "download_media": true,
  "ui_enabled": true
}
```

**局部覆盖**：可在 `config.local.json` 只写要改的字段（不入库，适合放 token）。

---

## 账号池机制

```
请求 → 预估积分 → 择优选号（积分多 + 使用少）
     → 提交任务 → 轮询 → 返回结果
     ↓ 失败
   -1 积分不足  → 标记 exhausted，换号
   401 未登录    → 标记 invalid，触发续期
   其它错误      → 冷却（15→30→…→300s 递增），换号重试
```

- **持久化**：`data/accounts.json`
- **自动续期**：`auto_renew` 开启时，失效 token 用 `accounts` 凭据重新登录
- **动态添加**：`POST /api/pool/add {"token":"..."}`，无需重启

---

## 工具

| 命令 | 用途 |
|------|------|
| `bun run src/tools/doctor.ts` | 诊断运行时/配置/连通性/token |
| `bun run src/tools/login-helper.ts` | 打开浏览器自动提取 token |
| `bun run src/tools/register-bot.ts` | 自动注册（需邮箱 API） |

---

## 测试

```bash
bun test              # 全部（37 项）
bun test test/unit    # 单元（24 项，无网络）
bun test test/e2e     # E2E（13 项，真实调用上游）
```

---

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| **403 + "Attention Required"** | 用了 Node 而非 bun | `bun run src/index.ts` |
| 生成返回 `NO_ACCOUNT` | 未配置 token | 见「获取 Token」 |
| 生成返回 401 | token 失效 | 重新提取或启用 `auto_renew` |
| `-1 积分不足` | 账号积分耗尽 | 换号 / 充值 |
| 轮询超时 | 任务耗时长 | 增大 `poll_max_attempts` |
| 视频模型报 VIP 错误 | 视频模型需 PREMIUM | 用 VIP 账号 |

---

## 架构

```
src/
├── index.ts              Bun.serve 入口 + 路由
├── api/openai.ts         OpenAI 兼容层（models/images/videos/chat）
├── core/
│   ├── upstream.ts       上游 HTTP 客户端（浏览器头 + 错误检测）
│   ├── config.ts         配置加载（支持 local 覆盖）
│   ├── catalog.ts        模型目录（动态刷新 + 内置快照兜底）
│   ├── account-pool.ts   账号池（轮换/冷却/积分/持久化）
│   ├── generation.ts     生成编排（积分→提交→轮询→结果）
│   ├── auth.ts           登录/注册/续期 + 可插拔邮箱 API
│   └── auto-renew.ts     定时校验与自动续期
├── tools/                doctor / login-helper / register-bot
└── web/panel.ts          Web 控制台（单页，零依赖）
```

设计原则：核心逻辑（`core/`）与 HTTP 层解耦，可独立测试与复用。

---

## 免责声明

本项目仅供**合法授权**用途：自有账号自动化、逆向工程学习、技术研究。
使用者须自行确保符合目标站点服务条款与所在地法律。作者不对任何滥用行为负责。

MIT © lza6
