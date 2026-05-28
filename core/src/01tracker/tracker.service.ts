import { getTopTickers, getTrendingTickers } from "../stocks/stocks.api.js";
import { analyzeArticles } from "../02analyzer/analyzer.service.js";
import {
  getTickerArticlesCache,
  setTickerArticlesCache,
} from "../01search/stock.cache.js";
import { getArticles } from "../articles/articles.api.js";
import type { Tracker } from "./tracker.js";
import {
  getAllTrackers,
  updateTrackerLastTriggered,
  upsertTracker,
  deleteTracker,
} from "./tracker.repo.js";
import { upsertManyTickerStocks } from "../01search/ticker-stock.repo.js";
import { env } from "../env.js";

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
    deleteTracker(tracker.ticker, tracker.priority, tracker.interval).catch(
      (err) => {
        console.error(
          `Error deleting expired tracker for ${tracker.ticker}:`,
          err
        );
      }
    );
    return;
  }

  async function runAnalysis() {
    let articles = await getTickerArticlesCache(tracker.ticker);
    if (articles === null) {
      articles = await getArticles({ ticker: tracker.ticker });
      if (articles.length > 0) {
        await setTickerArticlesCache(tracker.ticker, articles);
      }
    }
    if (articles.length > 0) {
      await analyzeArticles(tracker, articles, tracker.priority);
    }
  }
  runAnalysis().catch((err: unknown) => {
    console.error(`Error requesting analysis for ${tracker.ticker}:`, err);
  });

  tracker.lastTriggeredAt = now;
  updateTrackerLastTriggered(
    tracker.ticker,
    tracker.priority,
    tracker.interval,
    now
  ).catch((err) => {
    console.error(
      `Error updating tracker trigger time for ${tracker.ticker}:`,
      err
    );
  });
}

function scheduleTracker(tracker: Tracker) {
  const now = Date.now();

  if (tracker.expiresAt && tracker.expiresAt < now) {
    deleteTracker(tracker.ticker, tracker.priority, tracker.interval).catch(
      (err) => {
        console.error(
          `Error deleting expired tracker on initialization for ${tracker.ticker}:`,
          err
        );
      }
    );
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

export async function initPersistedTrackers() {
  await getAllTrackers().then((trackers) =>
    trackers.forEach((tracker) => scheduleTracker(tracker))
  );
}

// Diffs active trackers against a new stock list: stops removed tickers and starts new ones.
// Each new ticker gets a random jitter applied to both the initial fire and subsequent interval,
// so all fires for that ticker remain aligned to its jitter offset.
function refreshTrackerGroup(
  active: Record<string, Tracker>,
  newStocks: Array<{ ticker: string; name: string }>,
  buildTracker: (stock: { ticker: string; name: string }) => Tracker,
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
    refreshTrackerGroup(
      activeTopTickersTracker,
      topTickers,
      (stock) => ({
        ticker: stock.ticker,
        name: stock.name,
        priority: 1,
        expiresAt: null,
        interval: env.TOP_TICKERS_SCRAPE_INTERVAL_SEC * 1000,
        lastTriggeredAt: null,
      }),
      env.TOP_TICKERS_JITTER_SEC * 1000
    );
  } catch (err) {
    console.error("Failed to fetch top tickers", err);
  }
}

let lastTopTickerRefresh = Date.now();
export async function initTopTrackers() {
  await refreshTopTickers();

  // setInterval max delay is 2147483647 ms (~24.8 days). 4 weeks overflows this limit and defaults to 1ms.
  // Instead, we check daily if 4 weeks have elapsed.
  setInterval(
    () => {
      const now = Date.now();
      if (
        now - lastTopTickerRefresh >=
        env.TOP_TICKERS_REFRESH_INTERVAL_SEC * 1000
      ) {
        lastTopTickerRefresh = now;
        refreshTopTickers().catch((err) =>
          console.error("Error in top trackers refresh interval", err)
        );
      }
    },
    env.TOP_TICKERS_REFRESH_INTERVAL_SEC * 1000
  );
}

const TRENDING_PRIORITY = 2;
const activeTrendingTracker: Record<string, Tracker> = {};

async function refreshTrendingTickers() {
  console.log("Fetching trending tickers...");
  const refreshMs = env.TRENDING_REFRESH_INTERVAL_SEC * 1000;
  const trending = await getTrendingTickers();
  console.log(`Fetched ${trending.length} trending tickers.`);
  if (trending.length === 0) return;

  const expiresAt = Date.now() + refreshMs;
  await upsertManyTickerStocks(trending);
  await Promise.all(
    trending.map((stock) =>
      upsertTracker({
        ticker: stock.ticker,
        name: stock.name,
        priority: TRENDING_PRIORITY,
        interval: env.TRENDING_SCRAPE_INTERVAL_SEC * 1000,
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
      name: stock.name,
      priority: TRENDING_PRIORITY,
      expiresAt,
      interval: env.TRENDING_SCRAPE_INTERVAL_SEC * 1000,
      lastTriggeredAt: null,
    }),
    env.TRENDING_TICKERS_JITTER_SEC * 1000
  );
}

export async function initTrendingTickers() {
  await refreshTrendingTickers().catch((err) =>
    console.error("Initial trending tickers refresh failed", err)
  );
  setInterval(() => {
    refreshTrendingTickers().catch((err) =>
      console.error("Trending tickers refresh failed", err)
    );
  }, env.TRENDING_REFRESH_INTERVAL_SEC * 1000);
}

export async function saveTracker(
  ticker: string,
  name: string,
  priority: number,
  intervalMs: number,
  expirationMs: number | null
) {
  const newTracker: Tracker = {
    ticker,
    name,
    priority,
    interval: intervalMs,
    expiresAt: expirationMs,
    lastTriggeredAt: null,
  };

  await upsertTracker(newTracker);
  scheduleTracker(newTracker);
}
