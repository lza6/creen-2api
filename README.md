# Creen-2API

把 [creen.ai](https://www.creen.ai) 的 **AI 图像/视频生成**能力封装为本地 **OpenAI 兼容 API 网关**。

单进程 Node.js 服务，零外部依赖（除 express），支持**账号池轮换**与**纯协议直连**，可在任意 OpenAI 客户端中使用 Creen 的 68 个模型（Sora 2 / VEO 3.1 / Nano Banana Pro / Seedance / Kling / Wan …）。

---

## 目录结构

本仓库同时包含**逆向分析成果**与**网关实现**：

```
creen-2api/
├── 01-源代码/             creen.ai 前端编译产物（31 个 chunk，逆向原始素材）
│   └── _analysis-work/    分析中间产物（模块切分、导出索引等）
├── 02-源码分析文档/       30 份深度分析文档（API/认证/积分/模型/订阅…）
├── 03-抓取验证/           实测抓取数据与证据
│   └── _evidence/         模型清单、端点认证实测、原始 API 响应
├── 04-逆向工具链/         CDP 抓取脚本 + 全量 chunks + 34 个语言包
├── 05-网关实现/           ★ 本项目交付物（Node.js/Express）
└── scripts/              分析用的辅助脚本
```

---

## 快速开始

```bash
cd 05-网关实现
npm install
cp config.example.json config.json   # 填入你的 token
npm start
```

默认监听 `http://127.0.0.1:47840`。

### 用法（OpenAI SDK）

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:47840/v1", api_key="sk-local")

# 图像生成
resp = client.images.generate(
    model="nano-banana-pro",
    prompt="a cyberpunk cat",
    n=1,
)
print(resp.data[0].url)
```

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **OpenAI 兼容** | `/v1/images/generations`、`/v1/models`、`/v1/chat/completions`（图文） |
| **68 个模型** | 图像 20 / 视频 37 / 对口型 3 / 动作 5 / 漫画 3 |
| **账号池** | 多 cernel 账号 token 轮换，内含积分查询与自动择优选号 |
| **纯协议** | 直连 HTTP API，不依赖浏览器；Cloudflare 通过协议层头模拟绕过 |
| **任务轮询** | 提交 → 轮询 → 下载，全自动 |
| **Web 面板** | 内置管理界面（模型列表 / 账号状态 / 请求日志） |

---

## 文档

| 文档 | 内容 |
|------|------|
| [02-源码分析文档/](./02-源码分析文档/) | 30 份逆向分析（API 208 端点、认证、积分、模型、订阅） |
| [02-源码分析文档/29-实测模型清单与积分定价.md](./02-源码分析文档/29-实测模型清单与积分定价.md) | 68 个真实模型 + 积分定价 |
| [02-源码分析文档/30-端点认证行为实测.md](./02-源码分析文档/30-端点认证行为实测.md) | 端点认证要求实测 |
| [05-网关实现/docs/PROTOCOL.md](./05-网关实现/docs/PROTOCOL.md) | 上游协议逆向笔记（网关实现依据） |

---

## 免责声明

本项目仅供**合法授权**的用途：自有账号的自动化、逆向工程学习、技术研究。

使用者须自行确保符合目标站点服务条款及所在地法律。作者不对任何滥用行为负责。

---

## 开源协议

[MIT](LICENSE) © lza6
