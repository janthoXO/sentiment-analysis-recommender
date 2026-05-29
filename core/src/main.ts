// always keep this import to load environment variables before anything else
import { env } from "./env.js";
import path from "path";

// utils — no feature deps
import { createDb, runMigrations } from "./utils/postgres.repo.js";
import { createRedis } from "./utils/cache.repo.js";
import { connectMq } from "./utils/mq.repo.js";

// schema barrel (used by createDb so it knows the relational schema)
import * as schemas from "./schemas.js";

// repos
import { makeTickerStockRepo } from "./stocks/ticker-stock.repo.js";
import { makeUserTickerAccessRepo } from "./stocks/user-ticker-access.repo.js";
import { makeSourceScoreRepo } from "./sentiment/source-score.repo.js";
import { makeTrackerRepo } from "./tracker/tracker.repo.js";
import { makeWatchlistRepo } from "./watchlist/watchlist.repo.js";

// caches
import { makeStockCache } from "./stocks/stock.cache.js";
import { makeArticlesCache } from "./articles/articles.cache.js";
import { makeCandlesCache } from "./stocks/candles.cache.js";

// external APIs (no feature deps)
import { searchTickers, getCompanyPeers } from "./stocks/stocks.api.js";
import { getArticles } from "./articles/articles.api.js";
import { getTopTickers, getTrendingTickers } from "./trends/trends.api.js";

// services
import { makeAnalyzerService } from "./sentiment/analyzer.service.js";
import { makeStocksService } from "./stocks/stocks.service.js";
import { makeArticlesService } from "./articles/articles.service.js";
import { makeSentimentService } from "./sentiment/sentiment.service.js";
import { makeTrackerService } from "./tracker/tracker.service.js";

// routers
import { makeStocksRouter } from "./stocks/stocks.router.js";
import { makeCandlesRouter } from "./stocks/candles.router.js";
import { makeArticlesRouter } from "./articles/articles.router.js";
import { makeSentimentRouter } from "./sentiment/sentiment.router.js";
import { makeTrendsRouter } from "./trends/trends.router.js";
import { makeWatchlistRouter } from "./watchlist/watchlist.router.js";
import { makeAuthRouter } from "./auth/auth.router.js";
import { makeNotificationRouter } from "./notifications/notification.router.js";
import { makeNotificationService } from "./notifications/notification.service.js";
import { sentimentEmitter } from "./utils/events.js";

import { initApp } from "./router.js";

function redactEnvForLog(environment: typeof env): Record<string, unknown> {
  const secretKeys = new Set(["FINNHUB_API_KEY", "GEMINI_API_KEY"]);
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      secretKeys.has(key) && value ? "[redacted]" : value,
    ])
  );
}

console.log("Environment variables loaded.", redactEnvForLog(env));

async function bootstrap() {
  // ── Infrastructure ─────────────────────────────────────────────────────────
  const db = createDb(env.DB_URL, schemas);
  const redis = createRedis(env.CACHE_URL);

  await runMigrations(db, path.join(import.meta.dirname, "../drizzle"))
    .then(() => console.log("Database migrations completed"))
    .catch((err) => {
      console.error("Database migrations failed", err);
      throw err;
    });

  // ── Repos ──────────────────────────────────────────────────────────────────
  const tickerStockRepo = makeTickerStockRepo(db);
  const userTickerAccessRepo = makeUserTickerAccessRepo(db);
  const sourceScoreRepo = makeSourceScoreRepo(db);
  const trackerRepo = makeTrackerRepo(db);
  const watchlistRepo = makeWatchlistRepo(db);

  // ── Caches ─────────────────────────────────────────────────────────────────
  const stockCache = makeStockCache(redis);
  const articlesCache = makeArticlesCache(redis);
  const candlesCache = makeCandlesCache(redis);

  // ── Services (constructed without MQ first; MQ connects after) ────────────
  // To break the circular dependency (analyzer needs publish, mq needs analyzer),
  // we use a late-bound publish stub that is replaced once MQ connects.
  let publishAnalysisTask: (
    stock: import("./generated/in/index.js").StockRoot,
    jobId: string,
    sources: import("./generated/in/index.js").SourceRoot[],
    priority: number
  ) => void = () => {
    throw new Error("MQ not yet connected");
  };

  const analyzer = makeAnalyzerService({
    sourceScoreRepo,
    mq: { publishAnalysisTask: (...args) => publishAnalysisTask(...args) },
  });

  // Connect MQ now and wire the real publish function
  await connectMq(env.RABBITMQ_URL, env.MQ_EXCHANGE, {
    onAnalyzerResult: (result) => analyzer.receiveResult(result),
  })
    .then((client) => {
      publishAnalysisTask = client.publishAnalysisTask.bind(client);
      console.log("Connected to RabbitMQ");
      return client;
    })
    .catch((err) => {
      console.error("Failed to connect to RabbitMQ", err);
      throw err;
    });

  const stocksService = makeStocksService({
    tickerStockRepo,
    stockCache,
    searchTickers,
  });

  const articlesService = makeArticlesService({
    articlesCache,
    stockCache,
    sourceScoreRepo,
    getArticles,
  });

  const sentimentService = makeSentimentService({ analyzer });

  const trackerService = makeTrackerService({
    trackerRepo,
    sourceScoreRepo,
    stockCache,
    tickerStockRepo,
    analyzer,
    getArticles,
    getTopTickers,
    getTrendingTickers: () => getTrendingTickers(searchTickers),
  });

  // ── Routers ────────────────────────────────────────────────────────────────
  const stocksRouter = makeStocksRouter({
    stocksService,
    stockCache,
    tickerStockRepo,
    userTickerAccessRepo,
    getCompanyPeers,
    searchTickers,
  });

  const candlesRouter = makeCandlesRouter({ candlesCache });

  const articlesRouter = makeArticlesRouter({ articlesService });

  const sentimentRouter = makeSentimentRouter({
    sentimentService,
    tickerStockRepo,
  });

  const trendsRouter = makeTrendsRouter({
    stockRepo: tickerStockRepo,
    userTickerAccessRepo,
  });

  const watchlistRouter = makeWatchlistRouter({
    watchlistRepo,
    trackerService,
    tickerStockRepo,
    searchTickers,
  });

  const authRouter = makeAuthRouter({
    db,
    createDefaultListsForUser: (userId) =>
      watchlistRepo.createDefaultListsForUser(userId),
  });

  const notificationService = makeNotificationService({
    watchlistRepo,
    sourceScoreRepo,
    userTickerAccessRepo,
    env,
  });

  sentimentEmitter.on("source-update", (evt) =>
    notificationService.onSourceUpdate(evt)
  );

  const notificationRouter = makeNotificationRouter({ notificationService });

  // ── HTTP server ────────────────────────────────────────────────────────────
  initApp({
    stocksRouter,
    candlesRouter,
    articlesRouter,
    sentimentRouter,
    trendsRouter,
    watchlistRouter,
    authRouter,
    notificationRouter,
  });

  // ── Background trackers ────────────────────────────────────────────────────
  trackerService
    .initPersistedTrackers()
    .catch((err) => console.error("Failed to init persisted trackers", err));
  trackerService.initTopTrackers().catch((err) => {
    console.error("Failed to init top trackers", err);
  });
  trackerService
    .initTrendingTickers()
    .catch((err) => console.error("Failed to init trending tickers", err));
}

bootstrap().catch(() => {
  console.error("Failed to bootstrap application");
  process.exit(1);
});
