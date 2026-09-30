"use strict";
// 生成 29 号文档：实测模型清单与积分定价

const fs = require("fs");
const path = require("path");

const DIR = "C:/Users/Administrator.DESKTOP-EGNE9ND/Desktop/creen-2api/验证抓取";
const OUT = "C:/Users/Administrator.DESKTOP-EGNE9ND/Desktop/creen-2api/源码分析文档/29-实测模型清单与积分定价.md";

const s = JSON.parse(fs.readFileSync(path.join(DIR, "models-summary.json"), "utf8"));
const tables = fs.readFileSync(path.join(DIR, "models-tables.md"), "utf8");

const BT = "`"; // 反引号

function section(title, body) {
  return "### " + title + "\n\n" + body + "\n";
}

// 图像表
let imgT = "| 模型 | 积分(fee) | ID |\n|------|---------:|---:|\n";
s.imageModels.forEach((m) => (imgT += "| " + m.name + " | " + m.fee + " | " + m.id + " |\n"));

// 视频表
let vidT = "| 模型 | 积分(fee) | VIP | ID |\n|------|---------:|---:|---:|\n";
s.videoModels.forEach((m) => (vidT += "| " + m.name + " | " + m.fee + " | " + m.vip + " | " + m.id + " |\n"));

// 对口型
let lipT = "| 模型 | 积分 |\n|------|-----:|\n";
s.lipSyncModels.forEach((m) => (lipT += "| " + m.name + " | " + m.fee + " |\n"));

// 动作控制
let motT = "| 模型 | 积分 |\n|------|-----:|\n";
s.motionControlModels.forEach((m) => (motT += "| " + m.name + " | " + m.fee + " |\n"));

// 漫画模型
let comT = "| 模型 | 积分 |\n|------|-----:|\n";
s.comicModels.forEach((m) => (comT += "| " + m.name + " | " + m.fee + " |\n"));

// 漫画风格
let styT = "| code | 名称 | 描述 |\n|------|------|------|\n";
s.comicStyles.forEach((m) => (styT += "| " + m.code + " | " + m.name + " | " + m.desc + " |\n"));

// 漫画格式
let fmtT = "| 格式 | 名称 | 分镜数 |\n|------|------|-------:|\n";
s.comicFormats.forEach((m) => (fmtT += "| " + m.format + " | " + m.name + " | " + m.panel + " |\n"));

const byPanel = {};
s.comicFormats.forEach((f) => { byPanel[f.panel] = (byPanel[f.panel] || 0) + 1; });
const panelStr = Object.entries(byPanel).map(([p, c]) => p + "格 " + c + "种").join("、");

const total = s.imageModels.length + s.videoModels.length + s.lipSyncModels.length + s.motionControlModels.length + s.comicModels.length;

const doc = [
"# 29 — 实测模型清单与积分定价（真实 API 数据）",
"",
"> **数据来源**：用本工具（GetSourceCode v1.1.1）在**浏览器上下文内**直接调用站点 API 获取的真实响应。",
"> **抓取时间**：2026-09-30",
"> **数据文件**：`验证抓取/models.json`（原始响应）、`models-summary.json`（结构化）",
"",
"---",
"",
"## 0. 本文档的意义",
"",
"文档 05/06 中标注为 `待验证` 的以下项目，**现已全部实证**：",
"",
"| 前文待验证项 | 本文档状态 |",
"|-------------|-----------|",
"| 模型 `integralFee` 具体数值 | ✅ **" + total + " 个模型全部拿到** |",
"| 全部模型的完整清单 | ✅ 图像 " + s.imageModels.length + " + 视频 " + s.videoModels.length + " + 对口型 " + s.lipSyncModels.length + " + 动作 " + s.motionControlModels.length + " + 漫画 " + s.comicModels.length + " |",
"| 各模型 `vipLevel` | ✅ 视频模型全部 `vipLevel=2`；图像模型无限制 |",
"| 漫画风格/格式完整枚举 | ✅ 风格 " + s.comicStyles.length + " 个、格式 " + s.comicFormats.length + " 个 |",
"| 真实 CDN 域名 | ✅ `cdn.creen.ai`（含 OSS 签名） |",
"",
"---",
"",
"## 1. 实测方法",
"",
"```js",
"// 在浏览器页面上下文内直接 fetch（携带 Cloudflare 会话）",
"const res = await fetch(\"/api/aiVideo/models/v2\", {",
"  headers: { \"x-platform\": \"web\", \"x-version\": \"999.0.0\", \"x-language\": \"en\" }",
"});",
"// → { code: \"200\", data: { featuresModels, categories } }",
"```",
"",
"**关键**：Node 直连会被 Cloudflare 403；必须在**浏览器页面内**发请求。",
"",
"---",
"",
"## 2. 图像模型（" + s.imageModels.length + " 个）",
"",
imgT,
"> **积分区间 1 ~ 45**。最便宜：`Creen AI 2.0`（1 积分，平台自研）；最贵：`Nano Banana Pro`（45）。",
"> **`vipLevel` 为空** → 免费用户可用（仅受积分限制）。",
"",
"---",
"",
"## 3. 视频模型（" + s.videoModels.length + " 个）",
"",
vidT,
"**统计**：",
"- 积分区间 **25 ~ 225**",
"- **全部 " + s.videoModels.length + " 个模型 `vipLevel=2`**（需 PREMIUM 及以上 VIP）",
"- 最便宜：`Vidu Q2`（25）；最贵：`Veo 3`（225）",
"",
"### 3.1 供应商分布",
"",
"| 供应商 | 模型数 | 说明 |",
"|--------|-------:|------|",
"| **Kling**（可灵） | 9 | 型号最全（2.1 → 3.0 Omni） |",
"| **Seedance**（字节） | 7 | 1.0 Pro → 2.5 |",
"| **Wan**（阿里通义万相） | 7 | 2.2 Flash → 3.0 Prime |",
"| **Veo**（Google） | 4 | Veo 3 / 3 Fast / 3.1 / 3.1 Fast |",
"| **Hailuo**（MiniMax 海螺） | 3 | 02 / 2.3 / 2.3 Fast |",
"| **Vidu**（生数） | 2 | Q2 / Q3 |",
"| **Sora**（OpenAI） | 1 | Sora 2 |",
"| **Minimax** | 1 | H3 |",
"| **其它** | 3 | Creen AI 2.0（自研）/ Happy Horse 1.0 & 1.1 |",
"",
"> 这**印证了文档 06 从 Webhook 端点推断的供应商**（alibaba/byteplus/miniMax/mulerouter/pollo），并补充了更多。",
"",
"---",
"",
"## 4. 其它模型",
"",
"### 4.1 对口型（" + s.lipSyncModels.length + "）",
"",
lipT,
"### 4.2 动作控制（" + s.motionControlModels.length + "）",
"",
motT,
"### 4.3 漫画模型（" + s.comicModels.length + "）",
"",
comT,
"---",
"",
"## 5. 漫画风格（" + s.comicStyles.length + " 个）",
"",
styT,
"---",
"",
"## 6. 漫画格式（" + s.comicFormats.length + " 个）",
"",
"按分镜数分组：" + panelStr,
"",
fmtT,
"---",
"",
"## 7. 新发现的域名",
"",
"| 域名 | 用途 | 证据 |",
"|------|------|------|",
"| `cdn.creen.ai` | **真实资源 CDN** | 漫画风格/格式模板图 URL，含阿里云 OSS 签名（`OSSAccessKeyId=LTAI5t8iYqpr98kYtoS6ivdH`） |",
"",
"> 文档 01 记录的 `www.creen.ai` 是主站，`cdn.creen.ai` 是**新增发现的资源域名**。",
"",
"---",
"",
"## 8. 认证与权限实测",
"",
"| 端点 | 未登录响应 |",
"|------|-----------|",
"| `/api/aiVideo/models/v2` | ✅ 200（公开） |",
"| `/api/aiImage/models/v2` | ✅ 200（公开） |",
"| `/api/aiComic/models` | ✅ 200（公开） |",
"| `/api/audio/voiceTemplates` | ❌ **401**（需登录） |",
"",
"> 验证了文档 03 §11.4 的认证语义：模型列表公开，音色模板需认证。",
"",
"---",
"",
"## 9. 对前文文档的更新",
"",
"| 文档 | 更新内容 |",
"|------|---------|",
"| 05-积分消耗与计费机制 | 补充真实 `integralFee` 数值表 |",
"| 06-模型列表与功能体系 | 补充 " + total + " 个真实模型名 + 供应商分布 |",
"| 01-项目概览与技术架构 | 补充 `cdn.creen.ai` 域名 |",
"| 03-完整API接口目录 | 验证端点认证语义 |",
"",
"---",
"",
"## 10. 数据完整性声明",
"",
"| 项 | 证据等级 |",
"|----|---------|",
"| 模型名称与 ID | `已验证`（API 原始响应） |",
"| 积分值 `integralFee` | `已验证`（API 字段） |",
"| VIP 等级 `vipLevel` | `已验证`（API 字段） |",
"| 供应商归属 | `合理推断`（按模型名前缀分类） |",
"| 漫画风格/格式 | `已验证`（API 数组） |",
"| `cdn.creen.ai` | `已验证`（模板 URL） |",
"",
].join("\n");

fs.writeFileSync(OUT, doc, "utf8");
console.log("29 号文档已生成:", doc.length, "字符");
