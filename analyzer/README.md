# Analyzer — Sentiment Analysis Worker

Stateless Python worker that scores the sentiment of news article snippets and feeds the result back into the pipeline. It is the analyzer service inside the **sentiment-analysis-recommender** stock search engine.

---

## What is the bigger project?

A search engine that, given a stock ticker (or a sector / theme), returns recently published news scored by sentiment so the user can see at a glance whether the recent narrative around that stock is positive, neutral, or negative. Think "Bloomberg ticker, but every result has a thumb on a -1…+1 scale."

The pipeline:

```
┌──────────┐  HTTP/stream  ┌──────┐  scrape   ┌─────────┐
│ webclient│ ────────────▶ │ core │ ────────▶ │ Finnhub │
│  (React) │ ◀──────────── │(Node)│           └─────────┘
└──────────┘    ndJSON     └──┬───┘
                              │ publishes batched AnalyzerTask
                              ▼
                         ┌──────────┐
                         │ RabbitMQ │
                         │  tasks   │
                         └────┬─────┘
                              │ consume
                              ▼
                         ┌──────────┐
                         │ analyzer │  ◀── this service
                         │ (Python) │
                         └────┬─────┘
                              │ publishes AnalyzerResult
                              ▼
                         ┌──────────┐
                         │ RabbitMQ │
                         │ results  │
                         └────┬─────┘
                              │ consume
                              ▼
                         ┌──────────┐
                         │  core    │
                         └──────────┘
```

| Service | Stack | Responsibility |
| --- | --- | --- |
| `webclient/` | React + Vite + shadcn/ui | Search UI; consumes ndJSON stream of stock + score from core |
| `core/` | Node.js + Postgres + Redis | API gateway; scrapes news, publishes analysis jobs, aggregates per-article scores into per-stock results, and streams to webclient |
| **`analyzer/`** | Python + Transformers / sentence-transformers | **This service.** Scores each source snippet, publishes `AnalyzerResult` |
| `contracts/` | OpenAPI + AsyncAPI + JSON Schema | Shared message/REST contracts; codegen feeds TS DTOs into core and webclient |

The implementation is rolled out in increments (see [`docs/ImplementationPlan.md`](../docs/ImplementationPlan.md)): the basis is single-stock search; later increments add categorical search (GICS), semantic search (pgvector), background prefetch, watchlists with SSE alerts, and trending-momentum detection.

---

## Where the analyzer fits

The analyzer is the **stateless brain**: it owns no database connections, holds no per-user state, and can be horizontally scaled by running more containers.

**Input:** consumes batched [`AnalyzerTask`](../contracts/schemas/AnalyzerTask.json) messages from RabbitMQ.

```jsonc
{
  "ticker": "AAPL",
  "jobId": "AAPL-1710000000000",
  "sources": [
    {
      "url": "https://...",
      "snippet": "headline and summary text",
      "scrapedAtSec": 1710000000,
      "updatedAtSec": 1709999900
    }
  ]
}
```

**Output:** publishes [`AnalyzerResult`](../contracts/schemas/AnalyzerResult.json) back to RabbitMQ.

```jsonc
{
  "ticker": "AAPL",
  "jobId": "AAPL-1710000000000",
  "sources": [
    {
      "url": "https://...",
      "snippet": "...",
      "scrapedAtSec": 1710000000,
      "updatedAtSec": 1709999900,
      "score": 0.42
    }
  ]
}
```

### RabbitMQ topology (must match core)

- **Exchange:** `sentinel.analyze` (direct, durable)
- **Input queue:** `tasks`, bound on routing key `tasks`, max-priority 10
- **Output queue:** `results`, bound on routing key `result`

The analyzer asserts the same topology on connect, so it can boot in any order relative to the other services. Re-declaring an existing queue with matching arguments is idempotent; mismatched arguments would error loudly, which is what we want.

---

## How the scoring works

The analyzer exposes a shared `BaseScorer` interface and selects the backend with `SCORER_TYPE`.

### NLI scorer

The default `nli` scorer uses a **Natural Language Inference (NLI)** model. For each snippet it runs two NLI inferences:

1. *Premise:* the snippet. *Hypothesis:* `"The company's stock price will go up."` → take `P(entailment)` = `pos`
2. *Premise:* the snippet. *Hypothesis:* `"The company's stock price will go down."` → take `P(entailment)` = `neg`

The final score is `pos - neg`, which is naturally in `[-1, +1]` and matches the contract.

The default NLI model is [`cross-encoder/nli-deberta-v3-base`](https://huggingface.co/cross-encoder/nli-deberta-v3-base) (~700MB). The model name and both hypotheses are env-driven.

### FinBERT scorer

The `finbert` scorer uses a financial sequence classifier, defaulting to [`ProsusAI/finbert`](https://huggingface.co/ProsusAI/finbert). It tokenizes snippets directly, reads the model's positive / negative / neutral logits, and computes:

```text
score = P(positive) - P(negative)
```

Neutral probability is intentionally left out of the numerator, so neutral text stays near zero while strongly directional financial news moves toward `-1` or `+1`.

Both scorers load their model **once at startup** and implement `score_batch()`, so a single analyzer task can score all uncached source snippets in one model pass.

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
├── scripts/
│   ├── benchmark_hypotheses.py  # compares NLI hypothesis wording
│   └── benchmark_scorers.py     # compares NLI vs FinBERT
├── sentiment_nli.ipynb   # original exploratory notebook; the production scorer is derived from this
└── src/
    ├── __init__.py
    ├── cache.py          # in-process in-flight + TTL cache for scored sources
    ├── config.py         # env-driven Config dataclass
    ├── scorer.py         # BaseScorer, NliScorer, FinbertScorer, and scorer factory
    ├── mq.py             # MqClient — pika BlockingConnection, asserts topology, consume + publish
    └── main.py           # entry point: wires Config + scorer + cache + MqClient, signal handlers
```

---

## Running it

### Option A — full stack via docker-compose (recommended)

From the **repo root**:

```bash
docker compose up -d rabbitmq      # start the broker
docker compose up --build analyzer # build the analyzer image and run it
```

The first build downloads the selected Hugging Face model into the `hfcache` named volume; subsequent runs reuse it. Logs:

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

To run the analyzer with FinBERT instead of the default NLI backend:

```bash
SCORER_TYPE=finbert python -m src.main
```

You can still override the concrete Hugging Face checkpoint with `MODEL_NAME`.

### Benchmarks

The analyzer includes two local benchmarking scripts:

```bash
cd analyzer
python scripts/benchmark_hypotheses.py # compare NLI hypothesis pairs
python scripts/benchmark_scorers.py    # compare tuned NLI vs FinBERT
```

`benchmark_scorers.py` reports average positive score, average negative score, spread, polarity accuracy, maximum magnitude, and near-zero count on the curated sample set.

### Smoke testing

The analyzer connects, asserts the topology, and idles waiting for messages. To verify end-to-end you need something publishing batched tasks to the `tasks` queue. The full-stack route is to start `core`, `rabbitmq`, and `analyzer`, then run a search from the webclient.

A successful flow logs:

```
[INFO] src.mq: Connected to RabbitMQ; consuming from queue 'tasks', publishing results to 'result'
[INFO] analyzer.handler: Scored ticker=AAPL score=+0.4200 url=https://...
```

---

## Configuration

All settings come from environment variables. Defaults are in `.env.example` and `src/config.py`.

| Variable | Default | Notes |
| --- | --- | --- |
| `RABBITMQ_URL` | `amqp://sentinel:sentinel@localhost:5672` | Use `rabbitmq` as the host inside docker-compose |
| `MQ_EXCHANGE` | `sentinel.analyze` | Must match core |
| `MQ_TASK_QUEUE` | `tasks` | Must match core |
| `MQ_RESULT_ROUTING_KEY` | `result` | Must match what core consumes |
| `SCORER_TYPE` | `nli` | `nli` for hypothesis-based NLI, `finbert` for financial sequence classification |
| `MODEL_NAME` | scorer-specific | Defaults to `cross-encoder/nli-deberta-v3-base` for `nli`, `ProsusAI/finbert` for `finbert` |
| `HYPOTHESIS_POSITIVE` | `The company's stock price will go up.` | Used only by the `nli` scorer |
| `HYPOTHESIS_NEGATIVE` | `The company's stock price will go down.` | Used only by the `nli` scorer |
| `LOG_LEVEL` | `INFO` | |
| `PREFETCH_COUNT` | `1` | One in-flight message per worker; scale by running more containers |
| `CACHE_TTL_SECONDS` | `3600` | In-process per-article score cache TTL |

An explicit `MODEL_NAME` always wins. If it is unset, `src/config.py` picks the default model that matches `SCORER_TYPE`, so switching to FinBERT only requires `SCORER_TYPE=finbert`.

The task routing key (`tasks`) is hard-coded in `src/mq.py` because it is part of the queue contract with core, not a tuneable knob. See `MqClient.TASK_ROUTING_KEY`.

---

## Reliability behaviour

- **Manual ack.** Messages are acked only after a successful score + publish. Crash mid-processing → message stays on the queue and another worker picks it up.
- **Poison messages dropped.** Malformed JSON or a handler exception triggers `nack` with `requeue=False` so a single bad message can't loop forever and stall the queue.
- **Required field validation.** Tasks missing `ticker`, `jobId`, or a non-empty `sources` array are logged and dropped (acked, not requeued) because they aren't scoreable.
- **In-process deduplication.** The analyzer uses an in-flight ticker map plus a TTL cache keyed by `(ticker, url)` to avoid repeating model inference for duplicate source batches.
- **Graceful shutdown.** SIGINT and SIGTERM stop consuming, close the channel/connection, and exit.

---

## Future improvements

These are worth picking up if scores feel weak in the demo or QA.

### Stronger model

The default NLI model is general-purpose. The entailment probability is often low for both hypotheses simultaneously, which compresses the score range. FinBERT is now available as a pluggable backend and generally produces more interpretable financial sentiment probabilities. Further alternatives:

- **Larger NLI checkpoints** — `cross-encoder/nli-deberta-v3-large` is ~3× the model with sharper entailment probabilities. Cost: more RAM and slower inference.
- **Alternative FinBERT checkpoints** — compare other financial sequence classifiers by setting `SCORER_TYPE=finbert` and overriding `MODEL_NAME`.
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

- **Cross-message batching.** The analyzer already batches sources inside one task. A future optimization could pull multiple RabbitMQ messages and score them in one model pass. Trades latency for throughput.
- **GPU.** The Dockerfile is CPU-only. Switching to a CUDA base image (and a torch+cu121 wheel) gives ~10× scoring throughput, but adds Docker complexity and wouldn't help on the demo laptop.
- **Health endpoint.** Currently the worker has no HTTP surface; adding a `/health` would make orchestration cleaner, though for the demo `docker compose ps` is enough.

---

## Reference

- Original exploratory notebook: [`sentiment_nli.ipynb`](sentiment_nli.ipynb) — covers the NLI scoring rationale, sector-level correlation analysis, and the limits of headline-only sentiment as a market signal.
- Message contracts: [`../contracts/schemas/AnalyzerTask.json`](../contracts/schemas/AnalyzerTask.json), [`../contracts/schemas/AnalyzerResult.json`](../contracts/schemas/AnalyzerResult.json), [`../contracts/asyncapi.yml`](../contracts/asyncapi.yml).
- Architecture overview & roll-out plan: [`../docs/ImplementationPlan.md`](../docs/ImplementationPlan.md).
