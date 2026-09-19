# Sentinel Finance — Real-Time Stock News Sentiment Analysis with FinBERT

**Sentinel Finance is an open-source, self-hosted web app that scores the sentiment of the latest news for any US stock from −1 (bearish) to +1 (bullish) using FinBERT, and streams the results to your browser in real time.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-Node.js%2022-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97-FinBERT-FFD21E)

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

Search a ticker (`AAPL`), a company name (`Apple`) or a theme (`artificial intelligence`) and watch news cards appear within seconds, each one scored by a financial NLP model. It is built for retail investors, students and developers who want a transparent, self-hostable alternative to closed sentiment dashboards. It was built as a university project for the Web Information Retrieval course at the University of Genoa (UniGE).

---

## Table of contents

- [Key features](#key-features)
- [How to install](#how-to-install)
- [System requirements](#system-requirements)
- [How it works](#how-it-works)
- [Comparison with alternatives](#comparison-with-alternatives)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Architecture overview](#architecture-overview)
- [Project layout](#project-layout)
- [FAQ](#faq)
- [License](#license)

> For developer onboarding, service-by-service setup and environment variables, see [README_DEV.md](README_DEV.md).

---

## Key features

- **Real-time news sentiment scoring** for any US-listed stock, on a −1 (bearish) to +1 (bullish) scale.
- **FinBERT and NLI backends**: switch between [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) and [DeBERTa-v3 NLI](https://huggingface.co/cross-encoder/nli-deberta-v3-base) with one environment variable.
- **Progressive NDJSON streaming**: tickers, articles and scores render as they arrive instead of after a full batch.
- **Interactive price chart with news event pins**: OHLC chart (Today, 1D, 1W, 1M, 1Y) that pins big price moves to the articles published around them.
- **Natural-language theme search**: optional Gemini LLM maps queries like "clean energy" to matching tickers.
- **AI investment insight cards**: optional LLM summary with a bullish / bearish / neutral verdict and confidence level.
- **Watchlists with sentiment-change alerts**: get notified when the news sentiment of a watched stock shifts.
- **Trending tickers and background prefetch**: S&P 500 and trending stocks are kept warm in Redis for instant results.
- **Self-hosted and open source (MIT)**: runs locally with a single `docker compose up`.

---

## How to install

### Quick start with Docker Compose

1. Get a free API key from [Finnhub](https://finnhub.io/).
2. Clone the repository and start the full stack:

```bash
git clone https://github.com/janthoXO/sentiment-analysis-recommender.git
cd sentiment-analysis-recommender
echo "FINNHUB_API_KEY=your_key_here" > .env
docker compose up --build
```

3. Open [http://localhost:3000](http://localhost:3000) and search for a stock.

The first start downloads the FinBERT model (~700 MB) into a Docker volume. Later starts reuse it.

### Enable the optional LLM features

Add these lines to `.env` to turn on Gemini theme search and insight cards:

```bash
LLM_PROVIDER=google
GEMINI_API_KEY=your_gemini_key
LLM_INSIGHT_ENABLED=true
```

### Run without the ML model

For quick UI work, use the `test-analyzer` stub that returns random scores. See [README_DEV.md](README_DEV.md#local-setup).

---

## System requirements

| Requirement | Details |
|-------------|---------|
| OS | Linux, macOS (Intel and Apple Silicon) or Windows with WSL 2 |
| Docker | Docker Engine or Docker Desktop with Compose v2 |
| Memory | ~4 GB RAM free for the FinBERT analyzer and infrastructure |
| Disk | ~3 GB for images and the Hugging Face model cache |
| API keys | Finnhub (required, free tier works); Gemini (optional) |
| Browser | Any current Chromium, Firefox or Safari |

---

## How it works

### Search and discovery

Users can search by ticker symbol (`AAPL`), company name (`Apple`), or a natural-language theme (`artificial intelligence`). The home page surfaces currently trending US tickers automatically.

When `LLM_PROVIDER=google` is configured, theme queries are resolved by a Gemini model that maps the free-text input to a ranked list of matching tickers — enabling searches that go beyond what a static GICS category lookup can handle.

### Progressive sentiment stream

Results arrive progressively rather than all at once. The pipeline runs in three stages, each streaming as NDJSON:

1. **Tickers** — stock metadata (name, sector, exchange) appears as each match is found.
2. **Articles** — news headlines and summaries are fetched per ticker and emitted immediately.
3. **Sentiment scores** — each article is scored asynchronously by the ML worker; scores appear one by one as they arrive.

From the user's perspective, cards populate on screen within seconds of submitting a query, with scores filling in progressively rather than the page waiting for a full batch response.

### Stock detail view

Clicking a result opens a detailed view with:

- **OHLC price chart** — selectable time ranges (Today, 1D, 1W, 1M, 1Y) rendered via Recharts.
- **Event pins** — significant price movements are detected and pinned on the chart. Hovering a pin highlights the news articles from that time window, making it easy to correlate price swings with the surrounding narrative.
- **Scored article list** — all articles colour-coded by sentiment with links to the original source.
- **LLM insight card** — when enabled, a Gemini-generated paragraph summarises the overall sentiment narrative and assigns a confidence level and directional verdict (bullish / bearish / neutral).
- **Competitors accordion** — peer companies with their own sentiment scores, fetched in parallel.

### Watchlists and real-time alerts

Authenticated users can create named watchlists and add any ticker to them. A long-lived NDJSON notification stream compares the current sentiment state to a baseline taken the last time the user viewed the ticker. When the average score diverges meaningfully, a push notification is sent to the connected client.

### Background prefetch

A background scheduler keeps popular tickers warm in Redis so frequent searches return from cache instantly. Three job tiers run on separate intervals:

| Tier | Interval | Purpose |
|------|----------|---------|
| S&P 500 prefetch | 12 h | Warms the most-searched tickers overnight |
| Watchlist refresh | 1 h | Keeps watched tickers up to date for notification diffing |
| Trending detection | 10 min | Tracks tickers with sudden volume spikes |

---

## Comparison with alternatives

| Feature | Sentinel Finance | Commercial sentiment APIs / terminals | Generic finance portals |
|---------|------------------|----------------------------------------|-------------------------|
| **Open source** | Yes (MIT) | No (proprietary) | No |
| **Self-hosted** | Yes (Docker Compose) | No (SaaS) | No |
| **Per-article sentiment score** | Yes, −1 to +1 | Usually, paid tiers | Rarely |
| **Transparent model** | FinBERT / DeBERTa NLI, swappable | Black box | N/A |
| **Real-time streaming UI** | Yes (NDJSON) | Varies | Page reload |
| **Price chart with news pins** | Yes | Some | Basic news list |
| **Natural-language theme search** | Yes (optional Gemini) | Rare | Keyword search |
| **Cost** | Free (Finnhub free tier) | Subscription | Free with ads / premium |

---

## Design decisions and trade-offs

### NDJSON streaming instead of a single JSON response

**Decision:** every multi-result endpoint streams newline-delimited JSON rather than accumulating a full response before sending.

**Rationale:** the sentiment pipeline is inherently sequential — you can't score articles you haven't fetched yet, and fetching is slow. Streaming allows the UI to render the first result in under a second while the rest of the pipeline runs. It also means a single slow or failing article doesn't block the rest of the response.

**Trade-off:** NDJSON is harder to consume than a plain JSON array. It requires a streaming reader on the client and partial-parse handling. Error objects can appear mid-stream, so clients must handle `{ error, code }` lines alongside normal records.

---

### Stateless ML worker over an in-process scorer

**Decision:** sentiment scoring runs in a separate Python process that reads from and writes to RabbitMQ, rather than calling a model directly from the Node.js server.

**Rationale:** Python has the better ML ecosystem (Hugging Face Transformers, PyTorch). Keeping the worker stateless and message-driven means it can be horizontally scaled by adding containers without any coordination — a single RabbitMQ queue distributes work automatically.

**Trade-off:** adds operational complexity (RabbitMQ must be running), increases end-to-end latency by one async hop, and makes local development slightly heavier. The `test-analyzer` stub exists specifically to make development bearable without a live ML model.

---

### Two pluggable NLP backends (FinBERT vs NLI)

**Decision:** the analyzer supports two interchangeable scoring backends selectable via `SCORER_TYPE`.

| Backend | Model | Approach |
|---------|-------|----------|
| `finbert` | [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) | Financial-domain sequence classifier; maps text to positive / negative / neutral probabilities |
| `nli` | [cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base) | General NLI model; runs two inferences ("stock will go up" / "stock will go down") and takes `P(entailment up) − P(entailment down)` |

**Rationale:** FinBERT is trained on financial text and produces more domain-appropriate scores. The NLI approach is more general and hypothesis-driven — it lets you tune sentiment direction by rewriting the hypothesis strings without retraining.

**Trade-off:** FinBERT gives sharper, more financially-grounded scores but is less flexible. The NLI model's entailment probabilities are often low for both hypotheses simultaneously, which compresses the score range toward zero on neutral text. Both backends load their model once at startup and batch-score all articles in a single model pass.

---

### Priority queue for live vs. background jobs

**Decision:** `AnalyzerTask` messages carry a priority field (0–10). Live user queries use priority 10; background prefetch jobs use priority 1.

**Rationale:** without priorities, a background prefetch sweep over the S&P 500 would saturate the analyzer queue and delay live user searches by minutes.

**Trade-off:** RabbitMQ's per-message priority requires the queue to be declared with `x-max-priority`. This is part of the shared contract between `core` and `analyzer` — both must declare the queue with the same arguments or RabbitMQ will reject the re-declaration loudly. The queue declaration is idempotent when arguments match.

---

### Optional LLM layer

**Decision:** LLM features (theme-based search, insight cards) are gated behind `LLM_PROVIDER` and `LLM_INSIGHT_ENABLED`. The application is fully functional without them.

**Rationale:** API keys cost money, add external latency, and introduce a failure mode (rate limits, timeouts). The core value proposition — streaming NLP sentiment — works without any LLM. Making LLM features opt-in keeps the default deployment simple.

**Trade-off:** the UI does not expose the insight toggle unless the backend has `LLM_INSIGHT_ENABLED=true`. This means the feature is invisible unless explicitly turned on, which is the correct default but requires documentation for anyone who wants to try it.

---

### Contract-first API design with codegen

**Decision:** all service boundaries — REST routes and RabbitMQ message schemas — are defined in `contracts/` first. TypeScript types for both `core` and `webclient` are generated from these contracts by CI.

**Rationale:** a single YAML source of truth prevents the frontend and backend from silently diverging. CI fails if either service's generated code is out of date with the current contract, making breaking changes visible at review time rather than at runtime.

**Trade-off:** adding a new field requires touching the contract YAML, running codegen in two places, and committing the generated files. The overhead is small but non-zero; it disciplines the team to think about the API surface before implementing.

---

## Architecture overview

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

| Service | Stack | Role |
|---------|-------|------|
| `webclient` | React 19 · Vite · shadcn/ui · Tailwind | Search UI, charts, watchlist |
| `core` | Node.js · Express 5 · Drizzle ORM | API gateway, news fetching, score aggregation, auth |
| `analyzer` | Python · Transformers · PyTorch | Stateless NLP worker; scores article snippets |
| `contracts` | OpenAPI 3 · AsyncAPI 2 · JSON Schema | Shared REST and message contracts; drives codegen |

Infrastructure: **PostgreSQL** (user data, article scores), **Redis** (response cache), **RabbitMQ** (async scoring queue). News and price data come from the **Finnhub API**.

---

## Project layout

```
sentiment-analysis-recommender/
├── analyzer/           Python NLP worker (FinBERT / NLI)
├── contracts/          OpenAPI, AsyncAPI, and JSON Schema definitions
├── core/               Node.js API server
├── docs/               Architecture diagrams and implementation plan
├── test-analyzer/      Stub analyzer (random scores — no ML model needed)
├── webclient/          React frontend
├── docker-compose.yml              Local development stack
├── docker-compose.prod.yml         Production stack (pulls from GHCR)
└── llms.txt            Machine-readable project summary for AI tools
```

Each service directory contains its own README with setup and internals.

---

## FAQ

### What is Sentinel Finance?

Sentinel Finance is an open-source web application that fetches the latest news for US stocks and scores each article's sentiment from −1 (bearish) to +1 (bullish) with the FinBERT financial NLP model.

### How is the stock sentiment score calculated?

Each article headline and summary is passed to the analyzer. With FinBERT, the score is `P(positive) − P(negative)`. With the NLI backend, it is `P(entailment "stock will go up") − P(entailment "stock will go down")`. The ticker score is the average over its recent articles.

### Which stocks are supported?

All US-listed stocks available through the Finnhub API, including the full S&P 500, which is prefetched in the background.

### Is Sentinel Finance free?

Yes. The code is MIT licensed and the Finnhub free tier is enough to run it. Gemini LLM features are optional.

### Can I run it without a GPU?

Yes. The analyzer runs on CPU and switches to CUDA automatically when a GPU is available. Articles are batch-scored in a single model pass, so CPU inference is fast enough for interactive use.

### Is this financial advice?

No. Sentinel Finance is a research and educational tool. Sentiment scores describe the tone of news coverage, not the future price of a stock.

---

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 [@janthoXO](https://github.com/janthoXO) and [@RicarlOz](https://github.com/RicarlOz).
