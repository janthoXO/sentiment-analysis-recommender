# Sentinel Finance

**Real-time NLP sentiment analysis for equities.** Search any US stock ticker or company name and see how the latest news feels — scored from −1 (bearish) to +1 (bullish) — streamed to your browser as articles arrive.

Sentinel Finance is a self-hosted stock research tool built as a university project for the Web Information Retrieval course at UniGE. It combines a streaming NLP pipeline, two pluggable ML backends, an interactive price timeline with article event pins, and optional LLM-generated investment insights.

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

---

## Table of contents

- [Features](#features)
- [Design decisions & trade-offs](#design-decisions--trade-offs)
- [Architecture overview](#architecture-overview)
- [Project layout](#project-layout)

> For setup instructions and developer onboarding, see [README_DEV.md](README_DEV.md).

---

## Features

### Search & discovery

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

### Watchlists & real-time alerts

Authenticated users can create named watchlists and add any ticker to them. A long-lived NDJSON notification stream compares the current sentiment state to a baseline taken the last time the user viewed the ticker. When the average score diverges meaningfully, a push notification is sent to the connected client.

### Background prefetch

A background scheduler keeps popular tickers warm in Redis so frequent searches return from cache instantly. Three job tiers run on separate intervals:

| Tier | Interval | Purpose |
|------|----------|---------|
| S&P 500 prefetch | 12 h | Warms the most-searched tickers overnight |
| Watchlist refresh | 1 h | Keeps watched tickers up to date for notification diffing |
| Trending detection | 10 min | Tracks tickers with sudden volume spikes |

---

## Design decisions & trade-offs

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

Infrastructure: **PostgreSQL** (user data, article scores), **Redis** (response cache), **RabbitMQ** (async scoring queue).

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
└── docker-compose.prod.yml         Production stack (pulls from GHCR)
```

Each service directory contains its own README with setup and internals.
