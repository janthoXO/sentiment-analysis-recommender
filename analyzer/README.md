# Analyzer — Sentiment Analysis Worker

Stateless Python worker that scores the sentiment of news article snippets and feeds the result back into the pipeline. One of four services that make up the **sentiment-analysis-recommender** stock search engine.

---

## What is the bigger project?

A search engine that, given a stock ticker (or a sector / theme), returns recently published news scored by sentiment so the user can see at a glance whether the recent narrative around that stock is positive, neutral, or negative. Think "Bloomberg ticker, but every result has a thumb on a -1…+1 scale."

The pipeline:

```
┌──────────┐  HTTP    ┌──────┐  HTTP   ┌─────────┐  scrape   ┌──────────────┐
│ webclient│ ───────▶ │ core │ ──────▶ │ tracker │ ────────▶ │ Yahoo Finance│
│  (React) │ ◀─────── │(Node)│         │  (Node) │           │  / Finnhub   │
└──────────┘  ndJSON  └──┬───┘         └────┬────┘           └──────────────┘
                         │                  │
                         │                  │ publishes AnalyzerTask per article
                         │                  ▼
                         │             ┌──────────┐
                         │             │ RabbitMQ │
                         │             │  tasks.  │
                         │             │   high   │
                         │             └────┬─────┘
                         │                  │ consume
                         │                  ▼
                         │             ┌──────────┐
                         │             │ analyzer │  ◀── this service
                         │             │ (Python) │
                         │             └────┬─────┘
                         │                  │ publishes AnalyzerResult
                         │                  ▼
                         │             ┌──────────┐
                         └─ consume ── │ RabbitMQ │
                                       │ results  │
                                       └──────────┘
```

| Service | Stack | Responsibility |
| --- | --- | --- |
| `webclient/` | React + Vite + shadcn/ui | Search UI; consumes ndJSON stream of stock + score from core |
| `core/` | Node.js + Postgres + Redis | API gateway; aggregates per-article scores into per-stock results; streams to webclient |
| `tracker/` | Node.js + Redis | The only service that touches the public internet; scrapes news; publishes one `AnalyzerTask` per article |
| **`analyzer/`** | Python + sentence-transformers | **This service.** Scores each snippet, publishes `AnalyzerResult` |
| `contracts/` | OpenAPI + AsyncAPI + JSON Schema | Shared message/REST contracts; codegen feeds TS DTOs into core/tracker |

The implementation is rolled out in increments (see [`docs/ImplementationPlan.md`](../docs/ImplementationPlan.md)): the basis is single-stock search; later increments add categorical search (GICS), semantic search (pgvector), background prefetch, watchlists with SSE alerts, and trending-momentum detection.

---

## Where the analyzer fits

The analyzer is the **stateless brain**: it owns no database connections, holds no per-user state, and can be horizontally scaled by running more containers.

**Input:** consumes [`AnalyzerTask`](../contracts/schemas/AnalyzerTask.json) from RabbitMQ.

```jsonc
{
  "scanJobId": "uuid?",   // correlates back to the original user search
  "stockId":   "AAPL",    // required
  "ticker":    "AAPL",    // tracker also includes this
  "url":       "https://...",
  "snippet":   "raw text scraped from the article",
  "priority":  1          // AMQP property, not in the body
}
```

**Output:** publishes [`AnalyzerResult`](../contracts/schemas/AnalyzerResult.json) back to RabbitMQ.

```jsonc
{
  "scanJobId": "uuid?",
  "stockId":   "AAPL",
  "score":      0.42,     // in [-1, +1]
  "snippet":    "...",
  "url":        "https://..."
}
```

### RabbitMQ topology (must match the tracker)

- **Exchange:** `sentinel.tasks` (direct, durable)
- **Input queue:** `tasks.high`, bound on routing key `task.high`, max-priority 10
- **Output queue:** `results`, bound on routing key `result`

The analyzer asserts the same topology on connect, so it can boot in any order relative to the other services. Re-declaring an existing queue with matching arguments is idempotent; mismatched arguments would error loudly, which is what we want.

---

## How the scoring works

The score comes from a **Natural Language Inference (NLI)** model, not a fine-tuned sentiment classifier. For each snippet we run two NLI inferences:

1. *Premise:* the snippet. *Hypothesis:* `"This is positive news for investors."` → take `P(entailment)` = `pos`
2. *Premise:* the snippet. *Hypothesis:* `"This is negative news for investors."` → take `P(entailment)` = `neg`

The final score is `pos - neg`, which is naturally in `[-1, +1]` and matches the contract.

The default model is [`cross-encoder/nli-deberta-v3-base`](https://huggingface.co/cross-encoder/nli-deberta-v3-base) (~700MB). It's loaded **once at startup** so the first message isn't penalised by a cold start. Both the model name and the two hypotheses are env-driven (see [Configuration](#configuration)) so the team can swap the scoring approach without touching code.

---

## Project structure

```
analyzer/
├── .env.example          # template for runtime config
├── .gitignore
├── Dockerfile            # python:3.12-slim, single-stage
├── README.md             # ← this file
├── df_metadata.csv       # reference dataset from the original notebook (S&P 500 metadata)
├── df_news.csv           # reference dataset from the original notebook (~4k headlines)
├── requirements.txt      # pinned Python dependencies
├── sentiment_nli.ipynb   # original exploratory notebook; the production scorer is derived from this
└── src/
    ├── __init__.py
    ├── config.py         # env-driven Config dataclass
    ├── scorer.py         # SentimentScorer — loads the NLI model and computes the [-1, +1] score
    ├── mq.py             # MqClient — pika BlockingConnection, asserts topology, consume + publish
    └── main.py           # entry point: wires Config + SentimentScorer + MqClient, signal handlers
```

---

## Running it

### Option A — full stack via docker-compose (recommended)

From the **repo root**:

```bash
docker compose up -d rabbitmq      # start the broker
docker compose up --build analyzer # build the analyzer image and run it
```

The first build downloads the NLI model into the `hfcache` named volume; subsequent runs reuse it. Logs:

```bash
docker compose logs -f analyzer
```

### Option B — locally, against a local broker

Useful when iterating on Python code without rebuilding a container each time.

```bash
cd analyzer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # edit if you don't want the docker-compose defaults
python -m src.main
```

If your RabbitMQ is the docker-compose one, `.env.example` already has the right credentials. If you started RabbitMQ a different way (e.g. plain `brew install rabbitmq`), override:

```bash
RABBITMQ_URL=amqp://guest:guest@localhost:5672 python -m src.main
```

### Smoke testing

The analyzer connects, asserts the topology, and idles waiting for messages. To verify end-to-end you need *something* publishing to `task.high`. The cheapest route is the tracker (or a one-off Python publisher script that mimics it).

A successful flow logs:

```
[INFO] src.mq: Connected to RabbitMQ; consuming from queue 'tasks.high', publishing results to 'result'
[INFO] analyzer.handler: Scored stockId=AAPL score=0.0026 url=https://...
```

---

## Configuration

All settings come from environment variables. Defaults are in `.env.example` and `src/config.py`.

| Variable | Default | Notes |
| --- | --- | --- |
| `RABBITMQ_URL` | `amqp://sentinel:sentinel@localhost:5672` | Use `rabbitmq` as the host inside docker-compose |
| `MQ_EXCHANGE` | `sentinel.tasks` | Must match the tracker |
| `MQ_TASK_QUEUE` | `tasks.high` | Must match the tracker |
| `MQ_RESULT_ROUTING_KEY` | `result` | Must match what core consumes |
| `MODEL_NAME` | `cross-encoder/nli-deberta-v3-base` | Any HF CrossEncoder NLI model works |
| `HYPOTHESIS_POSITIVE` | `This is positive news for investors.` | Phrasing affects results — see tuning notes |
| `HYPOTHESIS_NEGATIVE` | `This is negative news for investors.` | |
| `LOG_LEVEL` | `INFO` | |
| `PREFETCH_COUNT` | `1` | One in-flight message per worker; scale by running more containers |

The task routing key (`task.high`) is hard-coded in `src/mq.py` because it's a contract with the tracker, not a tuneable knob — see the comment in `MqClient.TASK_ROUTING_KEY`.

---

## Reliability behaviour

- **Manual ack.** Messages are acked only after a successful score + publish. Crash mid-processing → message stays on the queue and another worker picks it up.
- **Poison messages dropped.** Malformed JSON or a handler exception triggers `nack` with `requeue=False` so a single bad message can't loop forever and stall the queue.
- **Required field validation.** Tasks missing `stockId`, `snippet`, or `url` are logged and dropped (acked, not requeued) — they aren't scoreable.
- **Graceful shutdown.** SIGINT and SIGTERM stop consuming, close the channel/connection, and exit.

---

## Future improvements

These are deliberate non-goals for the basis cut but worth picking up if scores feel weak in the demo or QA.

### Stronger model

The default NLI model is general-purpose. The entailment probability is often low for both hypotheses simultaneously, which compresses the score range (real-world snippets typically produce `|score| < 0.05`). The polarity is correct but the magnitude is small. Alternatives:

- **FinBERT** (`ProsusAI/finbert`) — fine-tuned for financial sentiment, gives directly interpretable positive/neutral/negative probabilities. The original [`docs/ImplementationPlan.md`](../docs/ImplementationPlan.md) suggests this. Drop-in via `MODEL_NAME` only if we adapt `scorer.py` (FinBERT is a sequence classifier, not a CrossEncoder, so the wrapper changes).
- **Larger NLI checkpoints** — `cross-encoder/nli-deberta-v3-large` is ~3× the model with sharper entailment probabilities. Cost: more RAM and slower inference.
- **Domain-specific fine-tune** — train the existing model on a labelled financial corpus (FinancialPhraseBank, FiQA). Most expensive option, biggest payoff.

### Better hypotheses

Hypothesis phrasing matters more than people expect. Worth A/B'ing:

- `"The company described will see its stock price go up."`
- `"This article suggests the stock should be bought."`
- Multi-hypothesis ensembles (run 3–5 paraphrases and average the entailment probability before subtracting).

Both are configurable via `HYPOTHESIS_POSITIVE` / `HYPOTHESIS_NEGATIVE` so this is zero-code experimentation.

### Aggregation strategies

Score aggregation is `core`'s job today (simple mean of per-article scores → per-stock score). Worth experimenting with:

- **Recency-weighted average** — newer headlines weigh more.
- **Source weighting** — Reuters / Bloomberg > clickbait aggregators.
- **Outlier trimming** — drop top/bottom N% before averaging.

### Operational

- **Batched inference.** Pull N messages off the queue, run a single NLI batch, publish N results. Trades latency for throughput. Only worth it if we hit a real bottleneck.
- **GPU.** The Dockerfile is CPU-only. Switching to a CUDA base image (and a torch+cu121 wheel) gives ~10× scoring throughput, but adds Docker complexity and wouldn't help on the demo laptop.
- **Health endpoint.** Currently the worker has no HTTP surface; adding a `/health` would make orchestration cleaner, though for the demo `docker compose ps` is enough.

---

## Reference

- Original exploratory notebook: [`sentiment_nli.ipynb`](sentiment_nli.ipynb) — covers the NLI scoring rationale, sector-level correlation analysis, and the limits of headline-only sentiment as a market signal.
- Message contracts: [`../contracts/schemas/AnalyzerTask.json`](../contracts/schemas/AnalyzerTask.json), [`../contracts/schemas/AnalyzerResult.json`](../contracts/schemas/AnalyzerResult.json), [`../contracts/asyncapi.yml`](../contracts/asyncapi.yml).
- Architecture overview & roll-out plan: [`../docs/ImplementationPlan.md`](../docs/ImplementationPlan.md).
