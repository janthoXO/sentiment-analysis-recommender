# Developer Onboarding

Welcome to the Sentinel Finance codebase. This guide covers everything you need to get the full stack running locally, understand how the services fit together, and start contributing.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Monorepo layout](#monorepo-layout)
- [Local setup](#local-setup)
- [Running services individually](#running-services-individually)
- [API contracts](#api-contracts)
- [CI/CD pipelines](#cicd-pipelines)
- [Environment variables reference](#environment-variables-reference)

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Docker + Compose v2 | latest | Required for all infrastructure |
| Node.js | 22 LTS | For `core` and `webclient` |
| pnpm | 10 | Package manager for both Node services |
| Python | 3.12 | Only if you want to run `analyzer` locally without Docker |
| [Finnhub API key](https://finnhub.io/) | — | Free tier is sufficient |

---

## Monorepo layout

```
sentiment-analysis-recommender/
├── analyzer/           Python NLP worker
│   ├── src/            Application source
│   └── scripts/        Benchmarking scripts
├── contracts/          Shared API contracts (single source of truth)
│   ├── openapi.yml     REST API (core ↔ webclient)
│   ├── asyncapi.yml    Message API (core ↔ analyzer via RabbitMQ)
│   └── schemas/        JSON Schema definitions for all DTOs
├── core/               Node.js/Express API server
│   ├── src/            Application source
│   └── drizzle/        Database migration files
├── docs/               Architecture diagrams and implementation plan
├── test-analyzer/      Stub analyzer (returns random scores — no ML model needed)
├── webclient/          React + Vite frontend
│   └── src/
│       ├── api/generated/   Auto-generated API client (do not edit)
│       ├── components/      Shared UI components
│       ├── hooks/           Data-fetching hooks
│       └── pages/           Route-level page components
├── docker-compose.yml          Local dev stack
└── docker-compose.prod.yml     Production stack (images from GHCR)
```

---

## Local setup

### 1. Clone and configure

```bash
git clone <repo-url>
cd sentiment-analysis-recommender
cp core/.env.example core/.env
# Edit core/.env and set FINNHUB_API_KEY=your_key_here
```

### 2. Start infrastructure

```bash
docker compose up -d core-postgres core-redis rabbitmq
```

This gives you Postgres on `:5432`, Redis on `:6379`, and RabbitMQ on `:5672` (management UI on `:15672`).

### 3. Start the analyzer

**With ML model (recommended for realistic scores):**

```bash
docker compose up --build analyzer
```

The first run downloads the selected Hugging Face model (~700 MB for the default FinBERT) into a named volume. Subsequent starts reuse it.

**Without ML model (faster, random scores):**

```bash
docker compose up --build test-analyzer
```

### 4. Start core

```bash
cd core
pnpm install
pnpm run dev
```

Core runs on `http://localhost:3001`. It auto-runs Drizzle migrations on startup.

### 5. Start webclient

```bash
cd webclient
pnpm install
pnpm run dev
```

The dev server runs on `http://localhost:5173` and proxies API calls to core.

---

## Running services individually

### core

```bash
cd core
pnpm run dev        # tsx watch (hot reload)
pnpm run build      # compile to dist/
pnpm run start      # run compiled output
pnpm run lint
pnpm run format
pnpm run db:generate  # generate a new Drizzle migration after schema changes
```

### webclient

```bash
cd webclient
pnpm run dev
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run contracts:generate   # regenerate API client from contracts/openapi.yml
```

### analyzer

```bash
cd analyzer
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m src.main

# Alternative backends:
SCORER_TYPE=nli python -m src.main
SCORER_TYPE=finbert MODEL_NAME=ProsusAI/finbert python -m src.main

# Benchmarks:
python scripts/benchmark_scorers.py
python scripts/benchmark_hypotheses.py
```

---

## API contracts

All service boundaries are defined in `contracts/` and checked by CI.

| Contract | Path | Consumer |
|----------|------|----------|
| REST API | `contracts/openapi.yml` | `webclient` (client via orval), `core` (server types via openapi-ts) |
| Message API | `contracts/asyncapi.yml` | `core` (publisher), `analyzer` (consumer) |
| JSON Schemas | `contracts/schemas/*.json` | Both; also used in codegen |

**Regenerating generated code after a contract change:**

```bash
# core (generates TypeScript types from OpenAPI)
cd core && pnpm run contracts:generate

# webclient (generates typed API client + React Query hooks via orval)
cd webclient && pnpm run contracts:generate
```

> **Important:** Never hand-edit `webclient/src/api/generated/` or `core/src/generated/`. These are fully regenerated from the contracts.

### Three-stage streaming pipeline

The REST API is designed around a progressive three-stage fetch for the frontend:

1. `GET /api/tickers?q=...` — streams `Stock` records as NDJSON (one per line).
2. `GET /api/tickers/{ticker}/articles` — streams `TickerArticles` records as NDJSON.
3. `GET /api/tickers/{ticker}/articles/sentiment?articleUrl=...` — streams `SourceResult` records as NDJSON as each article is scored.

Each stage starts as soon as the previous one emits its first record, so the UI can render progressively without waiting for the entire response.

---

## CI/CD pipelines

GitHub Actions workflows live in `.github/workflows/`.

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `build.yml` | push / PR | Runs sub-workflows for all services |
| `build.core.yml` | — | `pnpm install`, `tsc`, `eslint` |
| `build.webclient.yml` | — | `pnpm install`, `tsc`, `vite build`, `eslint` |
| `build.analyzer.yml` | — | `pip install`, Python linting |
| `contracts.yml` | push / PR | Runs contract validation sub-workflows |
| `contracts.core.yml` | — | Checks core codegen is up-to-date |
| `contracts.webclient.yml` | — | Checks webclient codegen is up-to-date |
| `package.yml` | push to main | Builds and pushes Docker images to GHCR |
| `deploy.yml` | manual | Deploys to Azure VM via SSH |
| `gate.yml` | push / PR | Quality gate — blocks merge on failures |

The `gate.yml` workflow is the merge gate. A PR is only mergeable when all checks pass.

---

## Environment variables reference

### core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `DB_URL` | `postgresql://sentinel:sentinel@localhost:5432/sentinel` | Postgres connection string |
| `CACHE_URL` | `redis://localhost:6379` | Redis connection string |
| `RABBITMQ_URL` | `amqp://sentinel:sentinel@localhost:5672` | RabbitMQ connection string |
| `FINNHUB_API_KEY` | — | **Required.** Finnhub API key |
| `LLM_PROVIDER` | `none` | `google` to enable Gemini features, `none` to disable |
| `LLM_MODEL` | `gemini-2.5-flash-lite` | Gemini model ID |
| `GEMINI_API_KEY` | — | Required when `LLM_PROVIDER=google` |
| `LLM_INSIGHT_ENABLED` | `false` | Enable per-ticker LLM insight generation |
| `LLM_THEME_MAX_TICKERS` | `5` | Max tickers returned by theme/LLM search |
| `LLM_INSIGHT_BATCH_SIZE` | `6` | Articles sent per insight request |
| `LLM_INSIGHT_MAX_ARTICLES` | `6` | Max articles used for insight |
| `LLM_INSIGHT_TIMEOUT_MS` | `8000` | LLM request timeout |
| `CACHE_TTL_INSIGHT_SEC` | `3600` | Redis TTL for cached insights |

### analyzer

| Variable | Default | Description |
|----------|---------|-------------|
| `RABBITMQ_URL` | `amqp://sentinel:sentinel@localhost:5672` | RabbitMQ connection string |
| `SCORER_TYPE` | `finbert` | `finbert` or `nli` |
| `MODEL_NAME` | scorer-specific | Override the Hugging Face checkpoint |
| `LOG_LEVEL` | `INFO` | Python logging level |
| `CACHE_TTL_SECONDS` | `3600` | In-process per-article score cache TTL |

See `analyzer/.env.example` for the full list including NLI hypothesis variables.
