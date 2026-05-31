import type { StockRoot } from "../generated/in/index.js";
import type { AnalyzerService } from "../sentiment/analyzer.service.js";
import type { SourceScoreRepo } from "../sentiment/source-score.repo.js";
import type { StockCacheService } from "../stocks/stock.cache.js";
import type { TickerStockRepo } from "../stocks/ticker-stock.repo.js";
import type { TrackerRepo } from "./tracker.repo.js";
import type { GetArticlesOptions } from "../articles/articles.api.js";
import type { Tracker } from "./tracker.js";
import { secondsToMilliseconds } from "date-fns";
import { env } from "../env.js";

export interface TrackerService {
  initPersistedTrackers(): Promise<void>;
  initTopTrackers(): Promise<void>;
  initTrendingTickers(): Promise<void>;
  saveTracker(
    ticker: string,
    priority: number,
    intervalMs: number,
    expirationMs: number | null
  ): Promise<void>;
}

export function makeTrackerService({
  trackerRepo,
  sourceScoreRepo,
  stockCache,
  tickerStockRepo,
  analyzer,
  getArticles,
  getTopTickers,
  getTrendingTickers,
}: {
  trackerRepo: TrackerRepo;
  sourceScoreRepo: SourceScoreRepo;
  stockCache: StockCacheService;
  tickerStockRepo: TickerStockRepo;
  analyzer: AnalyzerService;
  getArticles: (
    opts: GetArticlesOptions
  ) => Promise<import("../generated/in/index.js").SourceRoot[]>;
  getTopTickers: () => Promise<StockRoot[]>;
  getTrendingTickers: () => Promise<StockRoot[]>;
}): TrackerService {
  const intervalTimers = new Map<string, NodeJS.Timeout>();

  function getTrackerKey(tracker: Tracker) {
    return `${tracker.ticker}-${tracker.priority}-${tracker.interval}`;
  }

  function stopTracker(tracker: Tracker) {
    const key = getTrackerKey(tracker);
    const timer = intervalTimers.get(key);
    if (timer) {
      clearInterval(timer);
      intervalTimers.delete(key);
    }
  }

  function track(tracker: Tracker) {
    const now = Date.now();
    if (tracker.expiresAt && tracker.expiresAt < now) {
      stopTracker(tracker);
      trackerRepo
        .deleteTracker(tracker.ticker, tracker.priority, tracker.interval)
        .catch((err) => {
          console.error(
            `Error deleting expired tracker for ${tracker.ticker}:`,
            err
          );
        });
      return;
    }

    async function runAnalysis() {
      const stock = await tickerStockRepo.getTickerStock(tracker.ticker);
      if (!stock) return;
      let articles = await stockCache.getTickerArticlesCache(tracker.ticker);
      if (articles === null) {
        articles = await getArticles({ ticker: tracker.ticker });
        if (articles.length > 0) {
          await stockCache.setTickerArticlesCache(tracker.ticker, articles);
        }
      }
      if (articles.length === 0) return;
      await sourceScoreRepo.upsertManySourceMetadata(tracker.ticker, articles);
      for await (const __ignored of analyzer.requestSentiment(
        stock,
        articles,
        tracker.priority
      )) {
        void __ignored;
        // results are stored in source_score by receiveResult; nothing to collect here
      }
    }

    runAnalysis().catch((err: unknown) => {
      console.error(`Error requesting analysis for ${tracker.ticker}:`, err);
    });

    tracker.lastTriggeredAt = now;
    trackerRepo
      .updateTrackerLastTriggered(
        tracker.ticker,
        tracker.priority,
        tracker.interval,
        now
      )
      .catch((err) => {
        console.error(
          `Error updating tracker trigger time for ${tracker.ticker}:`,
          err
        );
      });
  }

  function scheduleTracker(tracker: Tracker) {
    const now = Date.now();

    if (tracker.expiresAt && tracker.expiresAt < now) {
      trackerRepo
        .deleteTracker(tracker.ticker, tracker.priority, tracker.interval)
        .catch((err) => {
          console.error(
            `Error deleting expired tracker on initialization for ${tracker.ticker}:`,
            err
          );
        });
      return;
    }

    const timeToNextTrigger = tracker.lastTriggeredAt
      ? Math.max(0, tracker.interval - (now - tracker.lastTriggeredAt))
      : 0;

    setTimeout(() => {
      track(tracker);
      const key = getTrackerKey(tracker);
      if (intervalTimers.has(key)) {
        stopTracker(tracker);
      }
      const timer = setInterval(() => track(tracker), tracker.interval);
      intervalTimers.set(key, timer);
    }, timeToNextTrigger);
  }

  function refreshTrackerGroup(
    active: Record<string, Tracker>,
    newStocks: Array<{ ticker: string }>,
    buildTracker: (stock: { ticker: string }) => Tracker,
    jitterMs: number
  ) {
    const newSet = new Set(newStocks.map((s) => s.ticker));

    for (const ticker in active) {
      if (!newSet.has(ticker)) {
        stopTracker(active[ticker]!);
        delete active[ticker];
      }
    }

    for (const stock of newStocks) {
      if (active[stock.ticker]) continue;
      const tracker = buildTracker(stock);
      active[stock.ticker] = tracker;
      setTimeout(() => scheduleTracker(tracker), Math.random() * jitterMs);
    }
  }

  const activeTopTickersTracker: Record<string, Tracker> = {};

  async function refreshTopTickers() {
    console.log("Fetching top tickers for prefetching...");
    try {
      const topTickers = await getTopTickers();
      console.log(`Fetched ${topTickers.length} Top Tickers.`);
      await tickerStockRepo.upsertManyTickerStocks(topTickers);
      refreshTrackerGroup(
        activeTopTickersTracker,
        topTickers,
        (stock) => ({
          ticker: stock.ticker,
          priority: env.TOP_TICKERS_PRIORITY,
          expiresAt: null,
          interval: secondsToMilliseconds(env.TOP_TICKERS_SCRAPE_INTERVAL_SEC),
          lastTriggeredAt: null,
        }),
        secondsToMilliseconds(env.TOP_TICKERS_JITTER_SEC)
      );
    } catch (err) {
      console.error("Failed to fetch top tickers", err);
    }
  }

  const activeTrendingTracker: Record<string, Tracker> = {};

  async function refreshTrendingTickers() {
    console.log("Fetching trending tickers...");
    const refreshMs = secondsToMilliseconds(env.TRENDING_REFRESH_INTERVAL_SEC);
    const trending = await getTrendingTickers();
    console.log(`Fetched ${trending.length} trending tickers.`);
    if (trending.length === 0) return;

    const expiresAt = Date.now() + refreshMs;
    await tickerStockRepo.upsertManyTickerStocks(trending);
    await Promise.all(
      trending.map((stock) =>
        trackerRepo.upsertTracker({
          ticker: stock.ticker,
          priority: env.TRENDING_PRIORITY,
          interval: secondsToMilliseconds(env.TRENDING_SCRAPE_INTERVAL_SEC),
          expiresAt,
          lastTriggeredAt: null,
        })
      )
    );

    refreshTrackerGroup(
      activeTrendingTracker,
      trending,
      (stock) => ({
        ticker: stock.ticker,
        priority: env.TRENDING_PRIORITY,
        expiresAt,
        interval: secondsToMilliseconds(env.TRENDING_SCRAPE_INTERVAL_SEC),
        lastTriggeredAt: null,
      }),
      secondsToMilliseconds(env.TRENDING_TICKERS_JITTER_SEC)
    );
  }

  let lastTopTickerRefresh = Date.now();

  return {
    async initPersistedTrackers() {
      await trackerRepo
        .getAllTrackers()
        .then((trackers) =>
          trackers.forEach((tracker) => scheduleTracker(tracker))
        );
    },

    async initTopTrackers() {
      await refreshTopTickers();
      setInterval(() => {
        const now = Date.now();
        if (
          now - lastTopTickerRefresh >=
          secondsToMilliseconds(env.TOP_TICKERS_REFRESH_INTERVAL_SEC)
        ) {
          lastTopTickerRefresh = now;
          refreshTopTickers().catch((err) =>
            console.error("Error in top trackers refresh interval", err)
          );
        }
      }, secondsToMilliseconds(env.TOP_TICKERS_REFRESH_INTERVAL_SEC));
    },

    async initTrendingTickers() {
      await refreshTrendingTickers().catch((err) =>
        console.error("Initial trending tickers refresh failed", err)
      );
      setInterval(() => {
        refreshTrendingTickers().catch((err) =>
          console.error("Trending tickers refresh failed", err)
        );
      }, secondsToMilliseconds(env.TRENDING_REFRESH_INTERVAL_SEC));
    },

    async saveTracker(ticker, priority, intervalMs, expirationMs) {
      const newTracker: Tracker = {
        ticker,
        priority,
        interval: intervalMs,
        expiresAt: expirationMs,
        lastTriggeredAt: null,
      };

      await trackerRepo.upsertTracker(newTracker);
      scheduleTracker(newTracker);
    },
  };
}
