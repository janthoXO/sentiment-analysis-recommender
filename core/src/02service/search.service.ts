import * as inFlight from "../02service/inFlight.service.js";
import * as cache from "../03repo/cache.repo.js";
import * as db from "../03repo/postgres.repo.js";
import { env } from "../env.js";
import { fetchFigiForTicker } from "../api/polygon.api.js";
import { v4 as uuidv4 } from "uuid";
import type { Root } from "@/api/generated/in/index.js";
import { postInternalTrack } from "@/api/generated/out/index.js";
import { finalizeJob } from "../02service/inFlight.service.js";

export async function processSearch(ticker: string): Promise<Root> {
  const existingJobId = inFlight.getJobIdForTicker(ticker);

  if (existingJobId) {
    return inFlight.addSubscriber(existingJobId);
  }

  // check if tracker is a valid stock
  let stockInfo = await db.getStock(ticker);
  if (!stockInfo) {
    const polygonData = await fetchFigiForTicker(ticker);
    stockInfo = polygonData;
    await db.saveStock(polygonData);
  }

  // Check if valid ticker already cached
  const cached = await cache.get(stockInfo.ticker);
  if (cached) {
    return cached;
  }

  const scanJobId = uuidv4();
  const trackerRes = await postInternalTrack({
    baseUrl: env.TRACKER_URL,
    body: {
      scanJobId,
      ticker: ticker,
      priority: 9,
    },
  });
  if (trackerRes.error) {
    console.error(
      "Failed to post track request:",
      JSON.stringify(trackerRes.error, null, 2)
    );
    throw new Error("Failed to post track request");
  }

  const expectedCount = trackerRes.data?.expectedArticles || 0;

  return inFlight.register(
    scanJobId,
    expectedCount,
    {
      ticker: stockInfo.ticker,
      name: stockInfo.name || stockInfo.ticker,
    },
    () => {
      finalizeJob(scanJobId);
    },
    env.SCATTER_TIMEOUT_MS
  );
}
