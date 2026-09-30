# 21 — 补充：OpenAPI 生成层与请求工具链

## 1. OpenAPI 客户端生成架构 `已验证`

平台使用 **OpenAPI Generator**（TypeScript `fetch`/`axios` 模板）生成 API 客户端。其内部工具函数（`9689` 模块 `37532`）完整还原如下：

| 导出 | 函数 | 职责 |
|------|------|------|
| `fY` | `BASE_PATH` | 默认基址 `"https://example.com"`（占位符） |
| `WC` | `assertParamExists` | 必填参数校验，抛 `RequiredError` |
| `YS` | `setApiKeyToObject` | 将 API Key 写入 header 对象（本项目用于注入 `x-auth-token`） |
| `rZ` | `addQueryParam` / `addQueryParams` | 递归拼接 query 参数（支持数组、嵌套对象） |
| `Np` | `serializeDataIfNeeded` | body 序列化（JSON MIME 时 `JSON.stringify`） |
| `uD` | `buildUrl` / `getUrl` | 由 URL 对象构建最终请求 URL |
| `yZ` | `request` 包装 | 执行请求并返回 |

### 1.1 `assertParamExists`（`WC`）
```js
function assertParamExists(fnName, paramName, paramValue) {
  if (paramValue === null || paramValue === undefined)
    throw new RequiredError(paramName,
      `Required parameter ${paramName} was null or undefined when calling ${fnName}.`);
}
```

### 1.2 `setApiKeyToObject`（`YS`）
```js
async function setApiKeyToObject(obj, keyParam, config) {
  if (config && config.apiKey) {
    const apiKey = typeof config.apiKey === "function"
      ? await config.apiKey(keyParam)
      : await config.apiKey;
    obj[keyParam] = apiKey;
  }
}
```
> 本项目所有端点调用 `YS(headers, "x-auth-token", config)`，即把配置里的 token 写到 `x-auth-token`。

### 1.3 `addQueryParams`（`rZ`）
递归处理：
- 数组 → 逐个 `append`
- 嵌套对象 → 点号路径展开（`a.b.c`）
- 已存在同名 → `append`，否则 `set`

### 1.4 `serializeDataIfNeeded`（`Np`）
```js
function serializeDataIfNeeded(value, requestOptions, config) {
  const needsSerialization =
    typeof value !== "string" || (config && config.isJsonMime?.(requestOptions.headers["Content-Type"]));
  return needsSerialization ? JSON.stringify(value ?? {}) : value ?? "";
}
```

### 1.5 `RequiredError` 类（`10896` 模块 `Q0`）
```js
class RequiredError extends Error {
  constructor(field, msg) { super(msg); this.field = field; this.name = "RequiredError"; }
}
```

### 1.6 `BaseAPI` 类（`10896` 模块 `yi`）
```js
class BaseAPI {
  constructor(config, basePath = BASE_PATH, axios = defaultAxios) {
    this.basePath = basePath; this.axios = axios;
    if (config) { this.configuration = config; this.basePath = config.basePath ?? basePath; }
  }
}
```

### 1.7 多服务器表（`10896` 模块 `z9`）
```js
const serverConfigurations = {};   // 空对象 —— 未配置多服务器路由
```
> 前端代码中大量出现 `z9["AuthControllerApi.xxx"][serverIndex]?.url` 的读取，但由于该表为空，实际恒为 `undefined`，请求落到 `basePath`。

---

## 2. 每个端点的标准生成结构 `已验证`

以 `alibabaWebhook` 为例（所有端点同构）：
```js
alibabaWebhook: async function (body, options = {}) {
  let baseOptions;
  assertParamExists("alibabaWebhook", "body", body);           // ① 校验
  const localVarUrlObj = new URL("/api/aiVideo/alibabaWebhook", BASE_PATH);  // ② URL
  if (config) baseOptions = config.baseOptions;
  let localVarRequestOptions = { method: "POST", ...baseOptions, ...options }; // ③ 方法
  const localVarHeaderParameter = {};
  await setApiKeyToObject(localVarHeaderParameter, "x-auth-token", config);   // ④ 认证头
  localVarHeaderParameter["Content-Type"] = "application/json";
  addQueryParam(localVarUrlObj, {});                                          // ⑤ query
  const headers = baseOptions?.headers ?? {};
  localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headers, ...options.headers };
  localVarRequestOptions.data = serializeDataIfNeeded(body, localVarRequestOptions, config); // ⑥ body
  return { url: buildUrl(localVarUrlObj), options: localVarRequestOptions };  // ⑦ 返回描述符
}
```

### 关键观察
1. **每个端点都调 `setApiKeyToObject(..., "x-auth-token", config)`** —— 因此"公开端点"也挂 token 钩子（token 为空时不带）。
2. **返回的是 `{url, options}` 描述符**，由外层 `request()` 执行。
3. **query 参数**通过 `addQueryParam(urlObj, { key: value })` 注入（如 `isSupportText`、`scene`、`code`）。
4. **path 参数**通过 `new URL("...{id}...".replace("{id}", encodeURIComponent(String(id))), BASE_PATH)` 注入。

---

## 3. 类包装层结构 `已验证`

每个 Controller 分三层：

```
① 原始函数层（o）：返回 {url, options} 描述符
      ↓
② 类方法层（X）：调用 ① 并执行
      async claimDayFreeIntegral(opts) {
        const d = await o(config).claimDayFreeIntegral(opts);
        const serverIndex = config?.serverIndex ?? 0;
        const url = z9["AuthControllerApi.claimDayFreeIntegral"]?.[serverIndex]?.url;
        return (t, r) => request(d, axios, url, config)(t, r);
      }
      ↓
③ 对外类（PN / VA / Wh / Di / Qo）：继承 BaseAPI，暴露方法
      class AuthControllerApi extends BaseAPI {
        claimDayFreeIntegral(opts) {
          return o(this.configuration).claimDayFreeIntegral(opts)
            .then(e => e(this.axios, this.basePath));
        }
      }
```

### 3.1 参数解构层 `已验证`
类方法会把**参数对象**解构为**位置参数**：
| 方法 | 解构 |
|------|------|
| `login` | `e.authLoginRequest` |
| `loginByGoogle` | `e.idToken`, `e.code` |
| `setNickname` | `e.nickname` |
| `verifyResetPwdCode` | `e.email`, `e.code` |
| `createGuest` | `e.cfIpcountry` |
| `getSysConfigForPost` | `e.requestBody`, `e.xVersion`, `e.xLanguage`, `e.cfIpcountry` |
| `createAiImage` | `e.aiImageCreateRequest` |
| `createAiImageV2` | `e.aiImageCreateV2Request` |
| `calculateIntegral1` | `e.aiImageCalculateIntegralRequest` |
| `createAiVideoV2` | `e.aiVideoCreateV2Request` |
| `getTaskStatus` | `e.resultId` |
| `getAiImageModelById` | `e.id` |
| `getAiImageTemplatesByScene` | `e.scene` |

---

## 4. 请求执行链 `已验证`

```
业务代码
  └─ api.method({ xxxRequest: {...} })
       └─ 类方法解构参数
            └─ 原始函数构造 {url, options}
                 └─ request(descriptor, axios, basePath, config)
                      └─ axios.request({ url, method, headers, data, params })
                           ├─ 请求拦截器（注入 x-platform/x-version/x-language/x-auth-token/x-finger）
                           └─ 响应拦截器（处理 code，或 x-no-handle 跳过）
```

---

## 5. 直接 axios 客户端（非 OpenAPI）`已验证`

| 模块 | 文件 | 端点 | 写法 |
|------|------|------|------|
| Project API | `8048` (74973) | `/api/project/*` | `n.FH.get/post/put/delete` |
| AiComic | `5142` (eV) | `/api/aiComic/*` | `w.FH.get/post` |
| AiExplore | `5142` | `/api/aiExplore/*` | `w.uE.get` |
| 图像创建 v2 | `5142` | `/api/aiImage/create/v2` | `w.uE.post` |
| 上传 | `5142` | `/api/upload/uploadTempFile` | `(0,N.Q)(file, path)` |

### 5.1 Project API 完整定义 `已验证`
```js
const projectApi = {
  createProject:        (e)    => api.FH.post("/api/project/create", e),
  getProjectList:       (e)    => api.FH.get("/api/project/list", { params: e }),
  getProjectItems:      (id,t) => api.FH.get(`/api/project/${id}/items`, { params: t }),
  deleteProject:        (id)   => api.FH.delete(`/api/project/${id}`),
  updateProject:        (id,t) => api.FH.put(`/api/project/${id}`, t),
  deleteProjectItems:   (e)    => api.FH.delete("/api/project/items", { data: e }),
  deleteProjectItemDatas: (e)  => api.FH.delete("/api/project/item/datas", { data: e }),
  regenerateProjectItem: (id)  => api.FH.post(`/api/project/item/${id}/regenerate`),
  getProjectAssets:     (e)    => api.FH.get("/api/project/item/datas", { params: e })
};
```

### 5.2 AiComic API 完整定义 `已验证`
```js
const comicApi = {
  getComicModels:  async () => { const r = await api.FH.get("/api/aiComic/models"); return r?.data ?? r ?? {}; },
  getComicFormats: async (panel) => {
    const r = await api.FH.get("/api/aiComic/formats", { params: panel !== undefined ? { panel } : undefined });
    const d = r?.data ?? r; return Array.isArray(d) ? d : [];
  },
  getComicStyles:  async () => { const r = await api.FH.get("/api/aiComic/styles"); const d = r?.data ?? r; return Array.isArray(d) ? d : []; },
  calculateIntegral: async (e) => {
    const r = await api.FH.post("/api/aiComic/calculateIntegral", e);
    const d = r?.data ?? r; return typeof d === "number" ? d : 0;
  },
  createComic:     async (e) => { const r = await api.uE.post("/api/aiComic/create", e); return r?.data ?? r; },
  enhanceComicPrompt: async (e) => { const r = await api.FH.post("/api/aiComic/enhancePrompt", e); return r?.data ?? r ?? ""; }
};
```

> **容错模式**：这些直接客户端普遍使用 `r?.data ?? r`，兼容「信封解包」与「裸响应」两种返回。

---

## 6. axios 实例导出符号 `已验证`

`9689` 模块 `26865` 导出：
| 符号 | 含义 |
|------|------|
| `uE` | axios 实例 |
| `FH` | 方法包装（`get/post/put/patch/delete`） |
| `pN` | `"x-no-handle"` 常量 |
| `$U` | toast 函数 |

各文件引用别名：
| 文件 | 别名 |
|------|------|
| `5142` | `w.uE`, `w.FH` |
| `8048` | `n.FH`, `n.uE` |
| `3866` | `cfg.uE` |
| `7747` | `cfg.uE` |
| `6628` | `cfg.uE` |

---

## 7. 请求参数注入方式对照 `已验证`

| 参数类型 | 注入方式 | 示例 |
|---------|---------|------|
| Path | `URL.replace("{id}", encodeURIComponent(...))` | `/api/aiImage/models/{id}` |
| Query | `addQueryParam(urlObj, { key: value })` | `isSupportText`、`scene`、`code` |
| Header | `headerObj[key] = value` | `x-platform`、`cf-ipcountry`、`x-admin-key` |
| Body | `serializeDataIfNeeded(body, ...)` | 各类 `*Request` |
| 认证 | `setApiKeyToObject(headers, "x-auth-token", config)` | 所有端点 |

---

## 8. 本文档与前文的互补

| 本文档 | 前文 |
|--------|------|
| OpenAPI 工具函数源码 | 02 仅描述行为 |
| 类包装三层结构 | 03 仅列端点 |
| 直接 axios 客户端源码 | 03 §11.5 仅提及 |
| 请求参数注入机制 | 02 §2 仅列 header |

---

## 9. 至此的完整文档体系

| # | 文档 | 主题 |
|---|------|------|
| 01-10 | 基础分析 | 概览/请求/API/认证/积分/模型/流程/错误码/i18n/附录 |
| 11 | 全量模块名册 | 603 模块 |
| 12 | 请求字段与认证步骤机 | 逐字段 + 8 步机 |
| 13 | 模块职责总表 | 逐模块 |
| 14 | UI 细节与图标集 | 97 图标 |
| 15 | 端点方法映射 | 端点→方法→请求体 |
| 16 | 业务处理器与弹窗文案 | 37 处理器 |
| 17 | 工作台 UI 结构与交互 | Tab/布局/上传 |
| 18 | 状态存储与音色模型 | 2 store |
| 19 | 外部依赖与完整性核验 | 26 域名 |
| 20 | 漫画选择器与状态字段全集 | 各 Tab state |
| 21 | 本文档 | OpenAPI 生成层 |
