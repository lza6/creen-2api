# 03 — 完整 API 接口目录

> 数据来源：`源代码/` 下 Next.js 编译产物（OpenAPI 生成客户端 + 直接 axios 调用）
> 规模：**10 个模块 / 146+ 唯一 URL 模板 / 约 149 个逻辑端点**
> 提取方法：`grep -oE '"/api/[^"]*"' *.js | sort -u` + 逐函数体解析

---

## 0. 架构总览（读表前必读）

前端存在**两个并行的 API 访问层**：

### 0.1 生成式客户端（OpenAPI Generator）
- **文件**：`3866`(Home)、`7747`(AiImage/AiVideo)、`8048`(Audio)、`9689`(Auth)、`6628`(Stat)
- **结构**：每个方法体形如 `for(let [e,a] of Object.entries(t)) d[e]=a;`（query 拼接）、`o.data=(0,l.Np)(t,o,e)`（body 序列化）
- **特征**：每个方法**无条件**调用 `await (0,l.YS)(o,"x-auth-token",e)` —— 即所有生成式端点都会尝试附带 `x-auth-token`（token 为 null 时不带）。因此"认证"列标注的是**语义要求**而非机械开关。
- **基址常量**：`fY = "https://example.com"`（占位符，实际被同源 `/` 或反向代理覆盖）

### 0.2 直接 axios 客户端
- **文件**：`8048`（Project 模块）、`5142`（AiComic / AiExplore / 部分 AiImage·AiVideo 直连）
- **用法**：`w.FH.post("/api/project/create", e)`、`w.uE.post(...)`、`w.FH.get(...)`
- **认证**：依赖全局请求拦截器自动注入（见 02 文档），无显式 header 写法

### 0.3 通用 Header 常量
| 头名 | 含义 |
|------|------|
| `x-auth-token` | 登录令牌 |
| `x-finger` | 设备指纹 |
| `x-guest-uid` / `x-guest-key` | 游客身份（游客登录用） |
| `x-auth-google-auto-login` | Google 自动登录标记 |
| `x-platform` | 平台标识（`web`） |
| `x-version` | 客户端版本（`999.0.0`） |
| `x-language` | 语言 |
| `x-admin-key` | 管理员密钥（`admin/syncJobStatus`） |
| `x-no-handle` | **跳过统一响应处理**，直接返回裸数据 |
| `x-no-show-msg-handle` | 500 错误时抑制全局 Toast |
| `X-Webhook-Id` / `X-Webhook-Timestamp` / `X-Webhook-Signature` | webhook 签名校验（仅 polloWebhook） |
| `cf-ipcountry` | Cloudflare 国家码（`createGuest` / `getSysConfig` / 部分模型查询） |

---

## 1. `/api/auth/*` — 认证与账号（31 个端点）

> 文件：`9689-6159fc9a74bd344f.js`（`AuthControllerApi`）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/auth/check` | GET | — | 可选 | `isAuthenticated` 校验登录态 |
| 2 | `/api/auth/login` | POST | `authLoginRequest{ email, password, turnstileToken }` | 公开 | 邮箱密码登录 |
| 3 | `/api/auth/loginByGuest` | POST | `authLoginByGuestRequest{ guestUid, guestKey }` | 公开 | 游客身份登录 |
| 4 | `/api/auth/loginByApple` | POST | `{ idToken }`（实为 Apple authorization.code） | 公开 | Apple 登录 |
| 5 | `/api/auth/loginByGoogle` | POST | `{ idToken?, code? }` | 公开 | Google 登录 |
| 6 | `/api/auth/logout` | POST | — | 必需 | 退出登录 |
| 7 | `/api/auth/createGuest` | POST | header `cf-ipcountry` | 公开 | 创建游客账号 |
| 8 | `/api/auth/confirmReg` | POST | `authConfirmRegRequest{ email, code }` | 公开 | 注册验证码确认 |
| 9 | `/api/auth/regSubmit` | POST | `authRegSubmitRequest{ email, password, confirmPassword, turnstileToken }` | 公开 | 注册提交 |
| 10 | `/api/auth/resendRegCode` | POST | `authSendRegCodeRequest{ email }` | 公开 | 重发注册验证码 |
| 11 | `/api/auth/sendResetPwdCode` | POST | `authSendResetPwdCodeRequest{ email }` | 公开 | 发送重置密码验证码 |
| 12 | `/api/auth/verifyResetPwdCode` | POST | `{ email, code }` | 公开 | 校验重置密码验证码 |
| 13 | `/api/auth/resetPassword` | POST | `authResetPasswordRequest{ email, code, newPwd, confirmPwd }` | 公开 | 重置密码 |
| 14 | `/api/auth/updatePassword` | POST | `authModifyPwdRequest` | 必需 | 修改密码 |
| 15 | `/api/auth/updateAccount` | POST | `authUpdateAccountRequest` | 必需 | 更新账号资料 |
| 16 | `/api/auth/setNickname` | POST | `{ nickname }` | 必需 | 设置昵称 |
| 17 | `/api/auth/randomNickname` | GET | — | 可选 | 随机昵称 |
| 18 | `/api/auth/getCaptcha` | GET | — | 公开 | 获取图形验证码 |
| 19 | `/api/auth/getSysConfig` | POST | `requestBody`；header `x-version`,`x-language`,`cf-ipcountry` | 可选 | 获取系统配置 |
| 20 | `/api/auth/getAccount` | GET | — | 必需 | 获取账号信息 |
| 21 | `/api/auth/getAccountForUpdate` | GET | — | 必需 | 获取账号（编辑用） |
| 22 | `/api/auth/getAccountInfoForTest` | GET | — | 必需 | 测试用账号信息 |
| 23 | `/api/auth/getAccountIntegral` | GET | — | 必需 | 获取积分余额 |
| 24 | `/api/auth/getWorkCount` | GET | — | 必需 | 获取作品数量 |
| 25 | `/api/auth/claimDayFreeIntegral` | GET | — | 必需 | 领取每日免费积分 |
| 26 | `/api/auth/deleteAccount` | DELETE | — | 必需 | 注销账号 |
| 27 | `/api/auth/updateAvatar` | POST | `uploadTempFileRequest`（multipart） | 必需 | 更新头像 |
| 28 | `/api/auth/updateBackgroundImage` | POST | `uploadTempFileRequest`（multipart） | 必需 | 更新背景图 |
| 29 | `/api/auth/uploadTempImage` | POST | `uploadTempFileRequest`（multipart） | 必需 | 上传临时图片 |
| 30 | `/api/auth/unbindByApple` | POST | — | 必需 | 解绑 Apple |
| 31 | `/api/auth/unbindByGoogle` | POST | — | 必需 | 解绑 Google |

---

## 2. `/api/home/*` — 首页与发现（11 个端点）

> 文件：`3866-e05837712b8556c6.js`（`HomeControllerApi`）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/home/getAdsImageModels` | GET | — | 可选 | 首页广告位-图像模型 |
| 2 | `/api/home/getAdsVideoModels` | GET | — | 可选 | 首页广告位-视频模型 |
| 3 | `/api/home/getAdsVideoEdits` | GET | — | 可选 | 首页广告位-视频编辑 |
| 4 | `/api/home/banners` | GET | header `x-platform`,`x-version` | 可选 | 首页 Banner |
| 5 | `/api/home/getFeatureByCode` | GET | query `code`；header `x-platform` | 可选 | 按 code 获取功能项 |
| 6 | `/api/home/getFeaturesByCategory` | GET | header `x-platform`,`x-version` | 可选 | 按分类获取功能列表 |
| 7 | `/api/home/getModelsByCategory` | GET | header `x-platform`,`x-version` | 可选 | 按分类获取模型列表 |
| 8 | `/api/home/aiImageInspirationWall` | GET | `request{ pageNo, pageSize }`（实测 pageSize:30） | 可选 | 图像灵感墙 |
| 9 | `/api/home/aiVideoInspirationWall` | GET | `request{ pageNo, pageSize }` | 可选 | 视频灵感墙 |
| 10 | `/api/home/ugcInspirationWall` | GET | `request{ pageNo, pageSize, type }` | 可选 | UGC 灵感墙 |
| 11 | `/api/home/health` | GET | — | 公开 | 健康检查 |

---

## 3. `/api/aiImage/*` — AI 图像（19 个端点）

> 文件：`7747-f79fca7a78bd15bd.js`（`AiImageControllerApi`）+ `5142`（直连 `create/v2`）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/aiImage/calculateIntegral` | POST | `aiImageCalculateIntegralRequest{ hasInputImage, modelId, resolution?, quality?, number, aspectRatio? }` | 必需 | 计算图像积分 |
| 2 | `/api/aiImage/create` | POST | `aiImageCreateRequest` | 必需 | 创建图像任务（v1） |
| 3 | `/api/aiImage/create/v2` | POST | `aiImageCreateV2Request`（实测：`modelId, baseImage, imageUrls[], prompt, resolution?, quality?, aspectRatio?, number, permission, projectId?, background?`） | 必需 | 创建图像任务（v2） |
| 4 | `/api/aiImage/{imageResultId}` | GET | path `imageResultId` | 必需 | 按 ID 获取图像详情 |
| 5 | `/api/aiImage/getTaskStatus/{imageResultId}` | GET | path `imageResultId` | 必需 | 单任务状态查询 |
| 6 | `/api/aiImage/getListTaskStatus` | POST | `aiImageCheckStatusRequest` | 必需 | 批量任务状态查询 |
| 7 | `/api/aiImage/getMyImageResultsByPage` | GET | query `reqData` | 必需 | 我的图像作品分页 |
| 8 | `/api/aiImage/regenerate/{resultId}` | POST | path `resultId` | 必需 | 重新生成 |
| 9 | `/api/aiImage/deleteResult/{resultId}` | DELETE | path `resultId` | 必需 | 删除生成结果 |
| 10 | `/api/aiImage/deleteResultImage` | DELETE | `aiImageDeleteResultImageRequest` | 必需 | 删除结果中的单张图 |
| 11 | `/api/aiImage/getFeature` | GET | header `x-platform` | 可选 | 图像功能配置 |
| 12 | `/api/aiImage/getTemplatesByScene` | GET | query `scene`；header `x-platform` | 可选 | 按场景获取模板 |
| 13 | `/api/aiImage/template/{templateId}` | GET | path `templateId` | 可选 | 按 ID 获取模板 |
| 14 | `/api/aiImage/template/getTemplateByCode/{templateCode}` | GET | path `templateCode` | 可选 | 按 code 获取模板 |
| 15 | `/api/aiImage/models` | GET | query `isSupportText` | 可选 | 全部图像模型 |
| 16 | `/api/aiImage/models/v2` | GET | query `isSupportText` | 可选 | 全部图像模型 v2 |
| 17 | `/api/aiImage/models/byText` | GET | — | 可选 | 文生图模型 |
| 18 | `/api/aiImage/models/byImage` | GET | — | 可选 | 图生图模型 |
| 19 | `/api/aiImage/models/{id}` | GET | path `id` | 可选 | 按 ID 获取模型 |

---

## 4. `/api/aiVideo/*` — AI 视频（42 个端点）

> 文件：`7747-f79fca7a78bd15bd.js`（`AiVideoControllerApi`）

### 4.1 生成/创建类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/aiVideo/create` | POST | `aiVideoCreateRequest`；header `x-version` | 必需 | 创建视频（v1） |
| 2 | `/api/aiVideo/create/v2` | POST | `aiVideoCreateV2Request{ modelId, mode, images?, videos?, audios?, prompt, resolution?, length, aspectRatio?, permission, enableAudio, projectId?, number }` | 必需 | 创建视频（v2） |
| 3 | `/api/aiVideo/createEditVideo` | POST | `aiVideoEditCreateRequest` | 必需 | 创建视频编辑 |
| 4 | `/api/aiVideo/createLipSync` | POST | `aiLipSyncCreateRequest{ modelId, video, audio, audioType, sessionId?, faceId?, projectId? }` | 必需 | 创建对口型视频 |
| 5 | `/api/aiVideo/createTalkingAvatar` | POST | `aiTalkingAvatarCreateRequest{ modelId, image, audio, audioType, speech?, prompt?, mode, projectId? }` | 必需 | 创建数字人视频 |
| 6 | `/api/aiVideo/createMotionControl` | POST | `aiMotionControlCreateRequest{ modelId, image, video, prompt, number, permission, projectId? }` | 必需 | 创建动作控制视频 |

### 4.2 积分计算类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 7 | `/api/aiVideo/calculateIntegral` | POST | `aiVideoCalculateIntegralRequest` | 必需 | 视频生成积分 |
| 8 | `/api/aiVideo/editVideoCalculateIntegral` | POST | `aiVideoEditCreateRequest` | 必需 | 视频编辑积分 |
| 9 | `/api/aiVideo/lipSyncCalculateIntegral` | POST | `aiLipSyncCreateRequest` | 必需 | 对口型积分 |
| 10 | `/api/aiVideo/motionControlCalculateIntegral` | POST | `aiMotionControlCreateRequest` | 必需 | 动作控制积分 |
| 11 | `/api/aiVideo/talkingAvatarCalculateIntegral` | POST | `aiTalkingAvatarCreateRequest` | 必需 | 数字人积分 |

### 4.3 任务状态/结果类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 12 | `/api/aiVideo/checkJobStatus` | POST | `aiVideoCheckStatusRequest` | 必需 | 校验任务状态 |
| 13 | `/api/aiVideo/getMyResultDetail` | GET | query `id` | 必需 | 我的结果详情 |
| 14 | `/api/aiVideo/getMyVideoResultsByPage` | GET | query `reqData` | 必需 | 我的视频分页 |
| 15 | `/api/aiVideo/{videoResultId}` | GET | path `videoResultId` | 必需 | 按 ID 获取视频详情 |
| 16 | `/api/aiVideo/deleteMyResult` | DELETE | query `id` | 必需 | 删除我的结果 |
| 17 | `/api/aiVideo/regenerate/{resultId}` | POST | path `resultId` | 必需 | 重新生成 |
| 18 | `/api/aiVideo/checkInputSafe` | GET | query `input` | 可选 | 输入内容安全检测 |
| 19 | `/api/aiVideo/lipSyncFaceRecognition` | POST | `aiLipSyncFaceRecognitionRequest{ video }`（返回 `{faceData[], sessionId}`） | 必需 | 人脸识别（对口型前置） |

### 4.4 模型/模板类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 20 | `/api/aiVideo/models` | GET | query `isSupportText` | 可选 | 全部视频模型 |
| 21 | `/api/aiVideo/models/v2` | GET | query `isSupportText`；header `cf-ipcountry` | 可选 | 全部视频模型 v2 |
| 22 | `/api/aiVideo/models/byText` | GET | — | 可选 | 文生视频模型 |
| 23 | `/api/aiVideo/models/byImage` | GET | — | 可选 | 图生视频模型 |
| 24 | `/api/aiVideo/models/{id}` | GET | path `id` | 可选 | 按 ID 获取模型 |
| 25 | `/api/aiVideo/editModels` | GET | query `editType` | 可选 | 视频编辑模型 |
| 26 | `/api/aiVideo/motionControlModels` | GET | — | 可选 | 动作控制模型 |
| 27 | `/api/aiVideo/motionControlTemplates` | GET | — | 可选 | 动作控制模板 |
| 28 | `/api/aiVideo/lipSyncModels` | GET | — | 可选 | 对口型模型 |
| 29 | `/api/aiVideo/talkingAvatarModels` | GET | — | 可选 | 数字人模型 |
| 30 | `/api/aiVideo/template/{templateId}` | GET | path `templateId` | 可选 | 按 ID 获取模板 |
| 31 | `/api/aiVideo/template/getAiVideoTemplateByCode/{templateCode}` | GET | path `templateCode` | 可选 | 按 code 获取模板 |
| 32 | `/api/aiVideo/getTemplatesByScene` | GET | query `scene`；header `x-platform` | 可选 | 按场景获取模板 |
| 33 | `/api/aiVideo/getTemplatesBySceneAndCode` | GET | query `scene`,`code`；header `x-platform` | 可选 | 场景+code 获取模板 |
| 34 | `/api/aiVideo/getTemplateFeatureBySceneAndCode` | GET | query `scene`,`code`；header `x-platform` | 可选 | 场景+code 获取功能配置 |
| 35 | `/api/aiVideo/getInspirationsByScene` | GET | query `scene`；header `x-platform` | 可选 | 按场景获取灵感 |
| 36 | `/api/aiVideo/getFeature` | GET | query `scene`；header `x-platform` | 可选 | 视频功能配置 |

### 4.5 Webhook 回调类（服务端→服务端）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 37 | `/api/aiVideo/alibabaWebhook` | POST | `body` | 签名/公开 | 阿里云任务回调 |
| 38 | `/api/aiVideo/byteplusWebhook` | POST | `body` | 签名/公开 | 火山引擎任务回调 |
| 39 | `/api/aiVideo/miniMaxWebhook` | POST | `body` | 签名/公开 | MiniMax 任务回调 |
| 40 | `/api/aiVideo/mulerouterWebhook` | POST | `webhookEventResponse` | 签名/公开 | MuleRouter 任务回调 |
| 41 | `/api/aiVideo/polloWebhook` | POST | `webhookResponse`；header `X-Webhook-Id`,`X-Webhook-Timestamp`,`X-Webhook-Signature` | **签名校验** | Pollo 任务回调 |

### 4.6 管理类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 42 | `/api/aiVideo/admin/syncJobStatus` | POST | `aiVideoCheckStatusRequest`；header `x-admin-key` | **管理员密钥** | 同步任务状态 |

---

## 5. `/api/audio/*` — 音频（18 个端点）

> 文件：`8048-ddab005f84bff524.js`（`AudioControllerApi`）

### 5.1 创建类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/audio/createMusic` | POST | `createMusicRequest{ projectId, prompt, speech, name, enableInstrumental, imageUrls[] }` | 必需 | 创建音乐 |
| 2 | `/api/audio/createSpeech` | POST | `createSpeechRequest{ projectId, audioType, audio, name, speech }` | 必需 | 创建语音 |
| 3 | `/api/audio/createVoice` | POST | `createVoiceRequest` | 必需 | 创建音色 |
| 4 | `/api/audio/createSoundEffect` | POST | `createSoundEffectRequest{ projectId, prompt, name, length, enableLoop }` | 必需 | 创建音效 |
| 5 | `/api/audio/createVoiceChanger` | POST | `createVoiceChangerRequest{ projectId, name, audioType, audio, voiceType, voice, enableRemoveBackgroundNoise }` | 必需 | 创建变声 |

### 5.2 积分计算类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 6 | `/api/audio/calculateSpeechIntegral` | POST | `calculateSpeechIntegralRequest{ speech }` | 必需 | 语音积分 |
| 7 | `/api/audio/calculateSoundEffectIntegral` | POST | `calculateSoundEffectIntegralRequest{ length }` | 必需 | 音效积分 |
| 8 | `/api/audio/calculateVoiceChangerIntegral` | POST | `calculateVoiceChangerIntegralRequest` | 必需 | 变声积分 |
| 9 | `/api/audio/getCreateMusicIntegral` | GET | — | 必需 | 音乐创建积分（预设） |
| 10 | `/api/audio/getCreateVoiceIntegral` | GET | — | 必需 | 音色创建积分（预设） |

### 5.3 编辑/任务/资源类

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 11 | `/api/audio/editAudio` | POST | `editAudioRequest` | 必需 | 编辑音频 |
| 12 | `/api/audio/enhanceMusic` | POST | `musicEnhanceRequest{ lyricsDraft, styles }` | 必需 | 音乐增强 |
| 13 | `/api/audio/getListTaskStatus` | POST | `aiAudioCheckStatusRequest{ resultIds: [] }` | 必需 | 批量任务状态 |
| 14 | `/api/audio/getTaskStatus/{resultId}` | GET | path `resultId` | 必需 | 单任务状态 |
| 15 | `/api/audio/deleteAudio/{audioId}` | DELETE | path `audioId` | 必需 | 删除音频 |
| 16 | `/api/audio/myAudiosByPage` | GET | `request{ createType, pageNo, pageSize }` | 必需 | 我的音频分页 |
| 17 | `/api/audio/voiceTemplates` | GET | — | 可选 | 音色模板列表 |
| 18 | `/api/audio/getLanguageForVoice` | GET | — | 可选 | 音色支持语言列表 |

---

## 6. `/api/aiComic/*` — AI 漫画（6 个端点）

> 文件：`5142.8cc95d675e4959d0.js`（直接 axios，对象 `eV`）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/aiComic/models` | GET | — | 可选 | 漫画模型列表 |
| 2 | `/api/aiComic/formats` | GET | query `panel` | 可选 | 漫画版式（按分镜数） |
| 3 | `/api/aiComic/styles` | GET | — | 可选 | 漫画风格列表 |
| 4 | `/api/aiComic/calculateIntegral` | POST | body（返回 number） | 必需 | 漫画积分计算 |
| 5 | `/api/aiComic/create` | POST | body | 必需 | 创建漫画任务 |
| 6 | `/api/aiComic/enhancePrompt` | POST | body（返回 string） | 必需 | 提示词增强 |

---

## 7. `/api/aiExplore/*` — 探索社区（3 个端点）

> 文件：`5142.8cc95d675e4959d0.js`（直接 axios `w.uE`）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/aiExplore/page` | GET | `params{ pageNo, pageSize, scene }`（实测 `pageNo:1,pageSize:30,scene:"3"`） | 可选 | 探索广场分页 |
| 2 | `/api/aiExplore/myFavorites/page` | GET | `params{ pageNum, pageSize }`（实测 `1,50`） | 必需 | 我的收藏分页 |
| 3 | `/api/aiExplore/myUploads/page` | GET | `params{ pageNum, pageSize, type }`（实测 `type:"2"`） | 必需 | 我的上传分页 |

> ⚠️ **参数命名不一致**：`/page` 用 `pageNo`，`myFavorites`/`myUploads` 用 `pageNum`。

---

## 8. `/api/project/*` — 项目（9 个端点）

> 文件：`8048-ddab005f84bff524.js`（模块 `74973`，直接 axios）

| # | 路径 | 方法 | 参数 / Body | 认证 | 用途 |
|---|------|------|------------|------|------|
| 1 | `/api/project/create` | POST | body（项目对象） | 必需 | 创建项目 |
| 2 | `/api/project/list` | GET | query `params` | 必需 | 项目列表 |
| 3 | `/api/project/{projectId}/items` | GET | path `projectId`；query `params` | 必需 | 项目内条目列表 |
| 4 | `/api/project/{projectId}` | PUT | path `projectId`；body | 必需 | 更新项目 |
| 5 | `/api/project/{projectId}` | DELETE | path `projectId` | 必需 | 删除项目 |
| 6 | `/api/project/items` | DELETE | body `data` | 必需 | 批量删除条目 |
| 7 | `/api/project/item/datas` | DELETE | body `data` | 必需 | 批量删除条目数据 |
| 8 | `/api/project/item/{itemId}/regenerate` | POST | path `itemId` | 必需 | 重新生成条目 |
| 9 | `/api/project/item/datas` | GET | query `params`（实测 `{size:50, assetsType:2}`） | 必需 | 获取项目资产 |

---

## 9. `/api/stat/*` — 统计打点（9 个端点）

> 文件：`6628-4c04d9413570425d.js`（`StatControllerApi`）；均为 POST，靠 header `x-no-handle:"true"` 抑制全局错误提示

| # | 路径 | 方法 | 参数 | 认证 | 用途 |
|---|------|------|------|------|------|
| 1 | `/api/stat/useTextToImage` | POST | query `isUltra` | 可选 | 打点：文生图 |
| 2 | `/api/stat/useTextToVideo` | POST | query `isUltra` | 可选 | 打点：文生视频 |
| 3 | `/api/stat/useImageToVideo` | POST | — | 可选 | 打点：图生视频 |
| 4 | `/api/stat/useImageFaceSwap` | POST | — | 可选 | 打点：图像换脸 |
| 5 | `/api/stat/useVideoFaceSwap` | POST | query `isUltra` | 可选 | 打点：视频换脸 |
| 6 | `/api/stat/useAiKiss` | POST | — | 可选 | 打点：AI 亲吻 |
| 7 | `/api/stat/useAiHug` | POST | — | 可选 | 打点：AI 拥抱 |
| 8 | `/api/stat/buyShow` | POST | — | 可选 | 打点：购买弹窗展示 |
| 9 | `/api/stat/buyClick` | POST | — | 可选 | 打点：购买点击 |

---

## 10. `/api/upload/*` — 文件上传（1 个端点）

| # | 路径 | 方法 | 参数 | 认证 | 用途 |
|---|------|------|------|------|------|
| 1 | `/api/upload/uploadTempFile` | POST | `multipart/form-data`，字段 `file`（响应为 URL 字符串） | 必需 | 通用临时文件上传 |

> 该端点是图像/视频/音频输入端点的**公共上传入口**。

---

## 11. 汇总

### 11.1 端点计数

| 模块 | 端点数 |
|------|-------|
| `/api/auth/*` | 31 |
| `/api/home/*` | 11 |
| `/api/aiImage/*` | 19 |
| `/api/aiVideo/*` | 42 |
| `/api/audio/*` | 18 |
| `/api/aiComic/*` | 6 |
| `/api/aiExplore/*` | 3 |
| `/api/project/*` | 9 |
| `/api/stat/*` | 9 |
| `/api/upload/*` | 1 |
| **合计** | **149** |

### 11.2 `calculateIntegral` 家族（13 个）

`aiImage/calculateIntegral`、`aiVideo/calculateIntegral`、`aiVideo/editVideoCalculateIntegral`、`aiVideo/lipSyncCalculateIntegral`、`aiVideo/motionControlCalculateIntegral`、`aiVideo/talkingAvatarCalculateIntegral`、`audio/calculateSpeechIntegral`、`audio/calculateSoundEffectIntegral`、`audio/calculateVoiceChangerIntegral`、`aiComic/calculateIntegral`，另加预设积分查询 `audio/getCreateMusicIntegral`、`audio/getCreateVoiceIntegral`。

### 11.3 路径参数清单
`{imageResultId}`、`{videoResultId}`、`{resultId}`、`{templateId}`、`{templateCode}`、`{audioId}`、`{id}`、`{projectId}`、`{itemId}`

### 11.4 认证语义说明

生成式客户端对**每个**方法都挂 `x-auth-token` 钩子，因此"可选/公开"标注是基于端点语义（登录、验证码、webhook、健康检查等）的推断；接入时应以 `code:"401"` 行为为准。

### 11.5 边界说明

1. **基址为占位符**：`fY = "https://example.com"`；两个客户端实际都走同源相对路径（`baseURL:"/"`），真实域名需另行确认（`待验证`）。
2. **Body 字段完整度**：TS 接口已被编译抹除，仓库内不存在内嵌 OpenAPI schema。表中 body 字段来自实际调用点（已核实者已列出）；仅标注模型名者表示字段未在前端调用点显式构造（`待验证`）。
3. **`{id}` 歧义**：`aiImage/models/{id}` 与 `aiVideo/models/{id}` 的 `{id}` 为模型 ID；`aiVideo/getMyResultDetail`、`aiVideo/deleteMyResult` 用的是 query `id` 而非路径参数。
