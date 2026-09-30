# Creen 上游协议逆向笔记

> 数据来源：`01-源代码/`（31 个前端 chunk）+ `03-抓取验证/`（实测 API 响应）+ `04-逆向工具链/`（CDP 抓包）
> 更新：2026-09-30

---

## 1. 关键约束：必须用 bun 运行

| 运行时 | 结果 |
|--------|------|
| Node 原生 `https` | ❌ **403**（Cloudflare WAF） |
| Node 原生 `http2` | ❌ **403** |
| Node + 完整浏览器头 | ❌ **403** |
| **bun 1.3.2 的 fetch** | ✅ **200** |

**根因**：Cloudflare 做 **TLS 指纹（JA3/JA4）校验**，不是 JS challenge（无 `cf_clearance` cookie，无 challenge 脚本）。
Node 的 TLS ClientHello 特征被识别为非浏览器；bun 的内置 TLS 栈接近真实浏览器。

> 实测证据：`_probe-*.ts`（已清理）；诊断工具 `bun run src/tools/doctor.ts` 可复现。

---

## 2. 请求约定

### 2.1 通用头（浏览器语义）

```
user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36
accept: application/json, text/plain, */*
accept-language: en-US,en;q=0.9
origin: https://www.creen.ai
referer: https://www.creen.ai/
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
x-platform: web
x-version: 999.0.0
x-language: en
```

### 2.2 认证头

```
x-auth-token: <裸 token>        # 非 Bearer！
```

### 2.3 统一响应信封

```jsonc
{
  "code": "200",              // 成功（字符串）；任务提交成功为数字 1
  "data": { ... },
  "msg": "错误信息",
  "errorCode": null,
  "fieldErrors": []
}
```

**双成功码**（重要）：

| 场景 | 成功码 | 类型 |
|------|--------|------|
| 查询/操作（models/auth…） | `"200"` | 字符串 |
| **异步任务提交**（create） | `1` | 数字 |
| 业务失败 | `-1 ~ -6` | 数字 |

---

## 3. 模型目录

### 3.1 端点

```
GET /api/aiImage/models        图像模型
GET /api/aiImage/models/v2     图像模型 v2
GET /api/aiVideo/models        视频模型
GET /api/aiVideo/models/v2     视频模型 v2
GET /api/aiComic/models        漫画模型
GET /api/aiComic/styles        漫画风格
GET /api/aiComic/formats       漫画格式
```

### 3.2 模型对象字段（实测）

```jsonc
{
  "id": 6,
  "title": "Nano Banana Pro",
  "integralFee": 45,          // 基础积分价
  "vipLevel": 0,              // 0=免费，2=需 PREMIUM
  "description": "...",
  "config": {
    "resolutionOptions": ["1K", "2K"],
    "durationOptions": [5, 10],
    "radioOptions": ["16:9", "9:16"],
    "modeOptions": [...]
  }
}
```

### 3.3 实测规模（2026-09-30）

| 类别 | 数量 | 积分区间 |
|------|-----:|---------|
| 图像 | 20 | 1 ~ 45 |
| 视频 | 37 | 25 ~ 225（全部 vipLevel=2） |
| 对口型 | 3 | — |
| 动作控制 | 5 | — |
| 漫画模型 | 3 | — |
| 漫画风格 | 8 | — |
| 漫画格式 | 40 | — |

---

## 4. 生成流程

```
① 计算积分（公开）
   POST /api/aiImage/calculateIntegral
   { modelId, hasInputImage, number, resolution?, quality?, aspectRatio? }
   → { code:"200", data: 45 }

② 提交任务（需 token）
   POST /api/aiImage/create/v2
   { modelId, baseImage, imageUrls[], prompt, number, permission,
     resolution?, quality?, aspectRatio?, projectId? }
   → { code: 1, data: { resultId, newProjectData? } }

③ 轮询状态（需 token）
   POST /api/aiImage/getListTaskStatus
   { resultIds: [resultId] }
   → { data: [{ status: "SUCCESS"|"2", resultImages: [...] }] }
   status: SUCCESS|"2" 成功；FAILED|"3" 失败；其它进行中

④ 获取详情（轮询无 URL 时）
   GET /api/aiImage/{resultId}
```

### 视频流程

```
② POST /api/aiVideo/create/v2
   { modelId, mode, images?, prompt, length, number, permission, enableAudio, ... }
③ POST /api/aiVideo/checkJobStatus  { resultIds: [...] }
④ GET  /api/aiVideo/getMyResultDetail?id={resultId}
```

`mode` 取值：`"1"` 文生视频 / `"2"` 首尾帧 / `"3"` 参考图生视频

---

## 5. 业务错误码（实测）

| code | 语义 | 处理 |
|------|------|------|
| `1` | 提交成功 | 取 `resultId` |
| `-1` | **积分不足** | 换号 / 提示充值 |
| `-2` | 生成失败 | 重试 |
| `-3` | 内容审核 / 任务进行中 | 不重试 |
| `-4` | 任务数超限 | 等待 |
| `-5` | 操作过频 | 退避重试 |
| `-6` | 自定义音色上限 | 换号 |

---

## 6. 认证

### 6.1 游客登录已失效 `已验证`

```
POST /api/auth/createGuest   → ✅ { guestUid, guestKey }
POST /api/auth/loginByGuest  → ⚠️ { code:"200", data:{ idToken: null } }
```

**实测**：无论是否带 `x-finger` 指纹，`idToken` 恒为 `null`；浏览器 localStorage 为空。
**结论**：服务端已关闭游客无感登录，**必须注册/登录**才能生成。

### 6.2 登录 / 注册

```
POST /api/auth/login        { authLoginRequest: { email, password, turnstileToken } }
POST /api/auth/regSubmit    { authRegSubmitRequest: { email, password, confirmPassword, turnstileToken } }
POST /api/auth/confirmReg   { authConfirmRegRequest: { email, code } }     → idToken
POST /api/auth/setNickname  { nickname }
GET  /api/auth/getAccount   → { integral, email, vipLevel, ... }
```

**Turnstile**：站点用 Cloudflare Turnstile 人机验证（site key `0x4AAAAAADm5Iz7T2Zxz8Iwe`）。
提交空 `turnstileToken` 时上游可能拒绝 —— 自动注册需打码服务。

---

## 7. 端点认证要求（实测）

| 端点 | 要求 |
|------|------|
| `/api/aiImage/models`、`/api/aiVideo/models` | 公开 |
| `/api/aiComic/models`、`styles`、`formats` | 公开 |
| `/api/aiImage/calculateIntegral` | 公开 |
| `/api/aiVideo/motionControlTemplates` | 公开（20 个） |
| `/api/home/banners` | 公开（12 个） |
| `/api/aiExplore/page` | 公开 |
| `/api/aiVideo/talkingAvatarModels` | **需认证**（401） |
| `/api/audio/voiceTemplates` | **需认证**（401） |
| `/api/audio/getLanguageForVoice` | **需认证**（401） |
| `/api/aiVideo/editModels` | **需 `editType` 参数**（否则 400） |
| `/api/aiImage/create/v2` | **需认证** |

---

## 8. 相关文档

- `02-源码分析文档/03-完整API接口目录.md` — 208 个端点全清单
- `02-源码分析文档/29-实测模型清单与积分定价.md` — 68 个模型 + 定价
- `02-源码分析文档/30-端点认证行为实测.md` — 逐端点认证实测
