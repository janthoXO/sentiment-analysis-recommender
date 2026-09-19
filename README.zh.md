# Sentinel Finance — 基于 FinBERT 的美股新闻实时情感分析

**Sentinel Finance 是一款开源、可自托管的 Web 应用，使用 FinBERT 对任意美股的最新新闻进行情感评分（−1 看跌 至 +1 看涨），并将结果实时流式传输到浏览器。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-Node.js%2022-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97-FinBERT-FFD21E)

<!-- README-I18N:START -->

[English](./README.md) | **汉语**

<!-- README-I18N:END -->

搜索股票代码（`AAPL`）、公司名称（`Apple`）或主题（`人工智能`），几秒内即可看到新闻卡片逐一出现，每篇文章都由金融 NLP 模型评分。本项目面向散户投资者、学生和开发者，是封闭式情感分析看板的透明、可自托管替代方案。它是热那亚大学（UniGE）Web Information Retrieval 课程的大学项目。

---

## 目录

- [核心功能](#核心功能)
- [如何安装](#如何安装)
- [系统要求](#系统要求)
- [工作原理](#工作原理)
- [与其他方案对比](#与其他方案对比)
- [设计决策与权衡](#设计决策与权衡)
- [架构概览](#架构概览)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [许可证](#许可证)

> 开发者入门、各服务的设置和环境变量，请参阅 [README_DEV.md](README_DEV.md)。

---

## 核心功能

- **实时新闻情感评分**：适用于任意美股上市公司，评分范围 −1（看跌）至 +1（看涨）。
- **FinBERT 与 NLI 后端**：通过一个环境变量在 [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) 与 [DeBERTa-v3 NLI](https://huggingface.co/cross-encoder/nli-deberta-v3-base) 之间切换。
- **渐进式 NDJSON 流**：股票、文章和评分随到随显，无需等待完整批量响应。
- **带新闻事件标注的交互式价格图表**：OHLC 图表（今日、1天、1周、1月、1年），将大幅价格波动与同期发布的文章关联。
- **自然语言主题搜索**：可选的 Gemini LLM 将“清洁能源”等查询映射为匹配的股票。
- **AI 投资洞察卡片**：可选的 LLM 摘要，给出看涨 / 看跌 / 中性判断及置信度。
- **带情感变化提醒的观察列表**：当观察股票的新闻情感发生变化时收到通知。
- **热门股票与后台预取**：S&P 500 和热门股票在 Redis 中保持缓存，结果即时返回。
- **自托管且开源（MIT）**：一条 `docker compose up` 即可在本地运行。

---

## 如何安装

### 使用 Docker Compose 快速开始

1. 在 [Finnhub](https://finnhub.io/) 获取免费 API 密钥。
2. 克隆仓库并启动完整服务栈：

```bash
git clone https://github.com/janthoXO/sentiment-analysis-recommender.git
cd sentiment-analysis-recommender
echo "FINNHUB_API_KEY=your_key_here" > .env
docker compose up --build
```

3. 打开 [http://localhost:3000](http://localhost:3000) 并搜索股票。

首次启动会将 FinBERT 模型（约 700 MB）下载到 Docker 卷中，之后的启动会复用该缓存。

### 启用可选的 LLM 功能

在 `.env` 中添加以下内容，以开启 Gemini 主题搜索和洞察卡片：

```bash
LLM_PROVIDER=google
GEMINI_API_KEY=your_gemini_key
LLM_INSIGHT_ENABLED=true
```

### 不使用 ML 模型运行

进行界面开发时，可使用返回随机评分的 `test-analyzer` 存根。详见 [README_DEV.md](README_DEV.md#local-setup)。

---

## 系统要求

| 要求 | 说明 |
|------|------|
| 操作系统 | Linux、macOS（Intel 与 Apple Silicon）或 Windows + WSL 2 |
| Docker | Docker Engine 或 Docker Desktop，需 Compose v2 |
| 内存 | FinBERT 分析器及基础设施约需 4 GB 可用内存 |
| 磁盘 | 镜像和 Hugging Face 模型缓存约需 3 GB |
| API 密钥 | Finnhub（必需，免费套餐即可）；Gemini（可选） |
| 浏览器 | 任意较新版本的 Chromium、Firefox 或 Safari |

---

## 工作原理

### 搜索与发现

用户可以通过股票代码（`AAPL`）、公司名称（`Apple`）或自然语言主题（`人工智能`）进行搜索。首页自动展示当前热门的美股代码。

当配置了 `LLM_PROVIDER=google` 时，主题查询由 Gemini 模型解析，将自由文本输入映射为排序后的匹配股票列表——支持超越静态 GICS 分类查找能力的搜索。

### 渐进式情感流

结果以渐进方式到达，而非一次性全部返回。管道分三个阶段运行，每个阶段均以 NDJSON 流式传输：

1. **股票代码** — 随着每个匹配项的发现，股票元数据（名称、行业、交易所）逐一出现。
2. **文章** — 每个股票的新闻标题和摘要在获取后立即发送。
3. **情感评分** — 每篇文章由 ML 工作进程异步评分；评分逐一到达。

从用户角度来看，提交查询后几秒内卡片即开始填充，评分渐进地出现，而非等待完整批量响应。

### 股票详情视图

点击某个结果将打开详情视图，包含：

- **OHLC 价格图表** — 可选时间范围（今日、1天、1周、1月、1年），通过 Recharts 渲染。
- **事件标注** — 检测重要价格变动并标注在图表上。悬停标注可高亮显示该时间窗口的新闻文章，便于将价格波动与周围叙事关联。
- **评分文章列表** — 所有文章按情感颜色编码，附原始来源链接。
- **LLM 洞察卡片** — 启用后，Gemini 生成一段段落，总结整体情感叙事，并给出置信度和方向性判断（看涨 / 看跌 / 中性）。
- **竞争对手折叠面板** — 并行获取同类公司及其情感评分。

### 观察列表与实时提醒

已认证用户可创建命名观察列表并添加任意股票。一个长连接 NDJSON 通知流会将当前情感状态与用户上次查看该股票时建立的基准进行比对。当平均评分出现明显偏差时，推送通知将发送至已连接的客户端。

### 后台预取

后台调度器在 Redis 中保持热门股票的缓存，使频繁搜索能够即时从缓存返回。三个作业层级以不同间隔独立运行：

| 层级 | 间隔 | 用途 |
|------|------|------|
| S&P 500 预取 | 12 小时 | 夜间预热搜索最频繁的股票 |
| 观察列表刷新 | 1 小时 | 保持被观察股票为最新状态，用于通知差异比对 |
| 热门检测 | 10 分钟 | 追踪成交量突然飙升的股票 |

---

## 与其他方案对比

| 功能 | Sentinel Finance | 商业情感 API / 终端 | 通用财经门户 |
|------|------------------|---------------------|--------------|
| **开源** | 是（MIT） | 否（专有） | 否 |
| **可自托管** | 是（Docker Compose） | 否（SaaS） | 否 |
| **逐篇文章情感评分** | 是，−1 至 +1 | 通常有，需付费套餐 | 很少 |
| **模型透明** | FinBERT / DeBERTa NLI，可切换 | 黑盒 | 不适用 |
| **实时流式界面** | 是（NDJSON） | 视产品而定 | 需刷新页面 |
| **带新闻标注的价格图表** | 是 | 部分支持 | 仅基础新闻列表 |
| **自然语言主题搜索** | 是（可选 Gemini） | 少见 | 关键词搜索 |
| **费用** | 免费（Finnhub 免费套餐） | 订阅制 | 免费含广告 / 高级版 |

---

## 设计决策与权衡

### 使用 NDJSON 流式传输而非单一 JSON 响应

**决策：** 每个多结果端点以换行符分隔的 JSON 流式传输，而非在发送前累积完整响应。

**理由：** 情感管道本质上是顺序的——无法对尚未获取的文章进行评分，而获取很慢。流式传输使 UI 能在管道运行期间于一秒内渲染第一个结果。这也意味着单个慢速或失败的文章不会阻塞其余响应。

**权衡：** NDJSON 比普通 JSON 数组更难消费。它需要客户端的流式读取器和部分解析处理。错误对象可能出现在流中间，因此客户端必须在处理普通记录的同时处理 `{ error, code }` 行。

---

### 无状态 ML 工作进程而非进程内评分器

**决策：** 情感评分运行在独立的 Python 进程中，通过 RabbitMQ 读写，而非直接从 Node.js 服务器调用模型。

**理由：** Python 拥有更好的 ML 生态系统（Hugging Face Transformers、PyTorch）。保持工作进程无状态且消息驱动意味着可以通过添加容器实现水平扩展，无需任何协调——单个 RabbitMQ 队列自动分发工作。

**权衡：** 增加了运维复杂性（RabbitMQ 必须运行），通过一次异步跳转增加了端到端延迟，并使本地开发稍显繁重。`test-analyzer` 存根的存在正是为了在没有实时 ML 模型的情况下使开发可行。

---

### 两个可插拔的 NLP 后端（FinBERT 与 NLI）

**决策：** 分析器支持两个可互换的评分后端，通过 `SCORER_TYPE` 选择。

| 后端 | 模型 | 方法 |
|------|------|------|
| `finbert` | [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) | 金融领域序列分类器；将文本映射为正面 / 负面 / 中性概率 |
| `nli` | [cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base) | 通用 NLI 模型；运行两次推理（"股票将上涨"/"股票将下跌"），取 `P(entailment up) − P(entailment down)` |

**理由：** FinBERT 在金融文本上训练，产生更具领域适应性的评分。NLI 方法更通用且假设驱动——通过重写假设字符串即可调整情感方向，无需重新训练。

**权衡：** FinBERT 提供更尖锐、更具金融依据的评分，但灵活性较低。NLI 模型的蕴含概率在两个假设上通常同时偏低，这将中性文本的评分范围压缩至接近零。两个后端均在启动时加载一次模型，并在单次模型传递中批量评分所有文章。

---

### 实时查询与后台作业的优先级队列

**决策：** `AnalyzerTask` 消息携带优先级字段（0–10）。实时用户查询使用优先级 10；后台预取作业使用优先级 1。

**理由：** 若无优先级，对 S&P 500 的后台预取扫描将使分析器队列饱和，导致实时用户搜索延迟数分钟。

**权衡：** RabbitMQ 的每消息优先级要求队列声明时携带 `x-max-priority`。这是 `core` 和 `analyzer` 之间共享契约的一部分——两者必须以相同参数声明队列，否则 RabbitMQ 会明确拒绝重新声明。队列声明在参数匹配时是幂等的。

---

### 可选 LLM 层

**决策：** LLM 功能（主题搜索、洞察卡片）通过 `LLM_PROVIDER` 和 `LLM_INSIGHT_ENABLED` 控制开关。应用在没有它们的情况下完全可用。

**理由：** API 密钥需要付费，增加外部延迟，并引入故障模式（速率限制、超时）。核心价值主张——流式 NLP 情感——无需任何 LLM 即可运行。将 LLM 功能设为可选保持了默认部署的简洁性。

**权衡：** 除非后端配置了 `LLM_INSIGHT_ENABLED=true`，否则 UI 不会暴露洞察开关。这意味着除非明确开启，该功能不可见，这是正确的默认值，但需要为想要尝试的用户提供文档。

---

### 契约优先的 API 设计与代码生成

**决策：** 所有服务边界——REST 路由和 RabbitMQ 消息模式——首先在 `contracts/` 中定义。`core` 和 `webclient` 的 TypeScript 类型由 CI 从这些契约生成。

**理由：** 单一 YAML 数据源可防止前后端静默分歧。如果任一服务的生成代码与当前契约不同步，CI 将失败，使破坏性变更在审查时而非运行时可见。

**权衡：** 添加新字段需要修改契约 YAML、在两个地方运行代码生成，并提交生成的文件。额外开销虽小但不为零；它促使团队在实现之前思考 API 表面。

---

## 架构概览

```
┌──────────────┐  HTTP/NDJSON   ┌─────────────────────────────────┐
│  React client│ ─────────────▶ │         core (Node.js)          │
│  (webclient) │ ◀───────────── │  Express · Postgres · Redis     │
└──────────────┘                └─────────────┬───────────────────┘
                                              │ AnalyzerTask (RabbitMQ)
                                              ▼
                                     ┌──────────────┐
                                     │   RabbitMQ   │
                                     └──────┬───────┘
                                            │ consume
                                            ▼
                                   ┌──────────────────┐
                                   │ analyzer (Python) │
                                   │  FinBERT / NLI   │
                                   └──────────────────┘
```

| 服务 | 技术栈 | 职责 |
|------|--------|------|
| `webclient` | React 19 · Vite · shadcn/ui · Tailwind | 搜索界面、图表、观察列表 |
| `core` | Node.js · Express 5 · Drizzle ORM | API 网关、新闻获取、评分聚合、认证 |
| `analyzer` | Python · Transformers · PyTorch | 无状态 NLP 工作进程；对文章片段评分 |
| `contracts` | OpenAPI 3 · AsyncAPI 2 · JSON Schema | 共享 REST 和消息契约；驱动代码生成 |

基础设施：**PostgreSQL**（用户数据、文章评分）、**Redis**（响应缓存）、**RabbitMQ**（异步评分队列）。新闻和价格数据来自 **Finnhub API**。

---

## 项目结构

```
sentiment-analysis-recommender/
├── analyzer/           Python NLP 工作进程（FinBERT / NLI）
├── contracts/          OpenAPI、AsyncAPI 和 JSON Schema 定义
├── core/               Node.js API 服务器
├── docs/               架构图和实现计划
├── test-analyzer/      存根分析器（随机评分——无需 ML 模型）
├── webclient/          React 前端
├── docker-compose.yml              本地开发栈
├── docker-compose.prod.yml         生产栈（从 GHCR 拉取）
└── llms.txt            面向 AI 工具的机器可读项目摘要
```

每个服务目录包含其自己的 README，内含设置和内部说明。

---

## 常见问题

### Sentinel Finance 是什么？

Sentinel Finance 是一款开源 Web 应用，获取美股的最新新闻，并使用 FinBERT 金融 NLP 模型为每篇文章给出 −1（看跌）至 +1（看涨）的情感评分。

### 股票情感评分是如何计算的？

每篇文章的标题和摘要会被发送给分析器。使用 FinBERT 时，评分为 `P(positive) − P(negative)`。使用 NLI 后端时，评分为 `P(entailment "股票将上涨") − P(entailment "股票将下跌")`。股票评分为其近期文章评分的平均值。

### 支持哪些股票？

Finnhub API 提供的所有美股上市公司，包括在后台预取的全部 S&P 500 成分股。

### Sentinel Finance 免费吗？

是的。代码采用 MIT 许可证，Finnhub 免费套餐即可运行。Gemini LLM 功能为可选项。

### 没有 GPU 能运行吗？

可以。分析器可在 CPU 上运行，检测到 GPU 时会自动切换至 CUDA。文章在单次模型传递中批量评分，因此 CPU 推理速度足以满足交互使用。

### 这是投资建议吗？

不是。Sentinel Finance 是一款研究与教育工具。情感评分描述的是新闻报道的语气，而非股票的未来价格。

---

## 许可证

基于 [MIT 许可证](LICENSE) 发布。Copyright (c) 2026 [@janthoXO](https://github.com/janthoXO) 与 [@RicarlOz](https://github.com/RicarlOz)。
