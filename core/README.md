# core

The Node.js/Express API server. It is the single entry point for the webclient, owns all database connections, orchestrates the sentiment pipeline, and serves a contract-defined REST API that streams results as NDJSON.

---

## What this service does

- **Stock search** — looks up tickers via Finnhub, caches results in Redis, and streams `Stock` records to the client.
- **Article fetching** — retrieves news articles for a ticker and streams `TickerArticles` records.
- **Sentiment orchestration** — publishes `AnalyzerTask` messages to RabbitMQ, receives `AnalyzerResult` messages back, persists scores in Postgres, and streams `SourceResult` records to the client.
- **Price candles** — fetches OHLC data from Yahoo Finance and caches it in Redis.
- **LLM insights** — optionally generates a Gemini-powered investment insight from scored articles.
- **Auth** — JWT-based register/login; bcrypt password hashing.
- **Watchlists** — per-user named lists with ticker membership.
- **Notifications** — long-lived NDJSON stream that pushes sentiment divergence events for watched tickers.
- **Background trackers** — scheduled jobs that keep popular and trending tickers warm in the cache.

---

## Local development

### Prerequisites

- Node.js 22 LTS, pnpm 10
- Postgres, Redis, and RabbitMQ running (see root `docker-compose.yml`)
- A Finnhub API key

### Setup

```bash
cd core
pnpm install
cp .env.example .env
# Edit .env: set FINNHUB_API_KEY and adjust connection strings if needed
pnpm run dev      # tsx watch with hot reload on :3001
```

Drizzle migrations run automatically on startup. If you need to apply them manually:

```bash
pnpm exec drizzle-kit migrate
```

### Available scripts

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Start with hot reload (tsx watch) |
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm run start` | Run compiled output |
| `pnpm run lint` | ESLint |
| `pnpm run format` | Prettier |
| `pnpm run contracts:generate` | Regenerate TypeScript types from `contracts/openapi.yml` |
| `pnpm run db:generate` | Generate a new Drizzle migration from schema changes |

---

## Project structure

```
src/
├── main.ts                   Entry point — wires all repos, services, and routers
├── router.ts                 Express app setup, middleware, route mounting
├── env.ts                    Environment variable parsing and validation
├── schemas.ts                Drizzle schema barrel (imported by createDb)
│
├── articles/                 Article fetching, caching, and routing
├── auth/                     JWT auth — register and login routes
├── notifications/            SSE notification stream for watchlist divergence
├── sentiment/                Analyzer service, score repo, investment insight
├── stocks/                   Stock search, candles, peers, theme queries
├── tracker/                  Background prefetch scheduler
├── trends/                   Trending tickers (Finnhub trends API)
├── watchlist/                User watchlist CRUD
│
├── llm/                      Gemini client wrapper (Vercel AI SDK)
├── middleware/                Error handling, HttpError class
└── utils/                    Postgres, Redis, and RabbitMQ clients; shared event emitter
```

Each feature slice follows the same pattern: `*.schema.ts` (Drizzle table) → `*.repo.ts` (data access) → `*.service.ts` (business logic) → `*.router.ts` (Express routes).

---

## Key design notes

**NDJSON streaming** — most endpoints write one JSON object per line as data becomes available rather than buffering the full response. This allows the webclient to render results progressively.

**Request deduplication** — when multiple clients search the same ticker simultaneously, core maps them to the same in-flight job so Finnhub is only called once.

**Background trackers** — `tracker.service.ts` manages a set of repeating jobs (S&P 500 prefetch every 12 h, watchlist tickers every 1 h, trending tickers every 10 min). Jobs use prioritised RabbitMQ messages so live user queries are never starved.

**Contract codegen** — `src/generated/in/` contains TypeScript types generated from `contracts/openapi.yml`. Run `pnpm run contracts:generate` after any contract change. Never edit these files by hand.

**Migrations** — schema changes go in `drizzle/` via `pnpm run db:generate`. The generated SQL file is committed to the repo and applied automatically on next startup.
