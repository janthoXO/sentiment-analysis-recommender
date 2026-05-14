import { getTopTickers } from "../stocks/stocks.api.js";
import {
  getInFlightJobId,
  requestAnalysis,
} from "../02analyzer/analyzer.service.js";
import type { Tracker } from "./tracker.js";
import {
  getAllTrackers,
  updateTrackerLastTriggered,
  upsertTracker,
  deleteTracker,
} from "./tracker.repo.js";

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

  const jobId = getInFlightJobId(tracker.ticker);
  if (!jobId) {
    requestAnalysis(tracker.ticker, tracker.priority).catch((err) => {
      console.error(`Error requesting analysis for ${tracker.ticker}:`, err);
    });
  }

  // update lastTriggeredAt
  tracker.lastTriggeredAt = now;
  // We update DB in background
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
    // skip expired trackers and remove them from db if they persist there
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
    // fire the first trigger after the calculated delay
    track(tracker);

    // after the first trigger, subsequent triggers will be handled by setInterval
    const key = getTrackerKey(tracker);
    if (intervalTimers.has(key)) {
      stopTracker(tracker);
    }

    const timer = setInterval(() => track(tracker), tracker.interval);
    intervalTimers.set(key, timer);
  }, timeToNextTrigger);
}

async function initPersistedTrackers() {
  await getAllTrackers().then((trackers) =>
    trackers.forEach((tracker) => scheduleTracker(tracker))
  );
}

const TopTickerRefreshInterval = 4 * 7 * 24 * 60 * 60 * 1000; // 4 weeks in milliseconds
const TopTickerInterval = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const activeTopTickersTracker: Record<string, Tracker> = {};

async function refreshTopTickers() {
  console.log("Fetching top tickers for prefetching...");
  try {
    const topTickers = await getTopTickers();
    console.log(`Fetched ${topTickers.length} Top Tickers.`);
    const newTopTickers = new Set(topTickers.map((t) => t.ticker));

    // Stop trackers for tickers that fell out
    for (const oldTicker in activeTopTickersTracker) {
      if (!newTopTickers.has(oldTicker)) {
        stopTracker(activeTopTickersTracker[oldTicker]!);
        delete activeTopTickersTracker[oldTicker];
      }
    }

    // Add new trackers
    for (const stock of topTickers) {
      if (activeTopTickersTracker[stock.ticker]) {
        continue; // already tracking this ticker
      }

      // set random timeout to avoid thundering herd if many new tickers are added at once
      setTimeout(
        () => {
          const tracker: Tracker = {
            ticker: stock.ticker,
            name: stock.name,
            priority: 1,
            expiresAt: null,
            interval: TopTickerInterval,
            lastTriggeredAt: null,
          };
          scheduleTracker(tracker);
          activeTopTickersTracker[stock.ticker] = tracker;
        },
        Math.random() * 30 * 60 * 1000
      ); // random delay up to 30 minutes
    }
  } catch (err) {
    console.error("Failed to fetch top tickers", err);
  }
}

let lastTopTickerRefresh = Date.now();
async function initTopTrackers() {
  await refreshTopTickers();

  // setInterval max delay is 2147483647 ms (~24.8 days). 4 weeks overflows this limit and defaults to 1ms.
  // Instead, we check daily if 4 weeks have elapsed.
  setInterval(
    () => {
      const now = Date.now();
      if (now - lastTopTickerRefresh >= TopTickerRefreshInterval) {
        lastTopTickerRefresh = now;
        refreshTopTickers().catch((err) =>
          console.error("Error in top trackers refresh interval", err)
        );
      }
    },
    24 * 60 * 60 * 1000
  ); // Check every 24 hours
}

export async function initTracker() {
  await Promise.all([initPersistedTrackers(), initTopTrackers()]);
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

  // instantly start the tracking logic locally as well since we just created it
  scheduleTracker(newTracker);
}
