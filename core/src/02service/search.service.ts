import * as inFlight from "../02service/inFlight.service.js";
import * as cache from "../03repo/cache.repo.js";
import * as db from "../03repo/postgres.repo.js";
import { env } from "../env.js";
import { finalizeJob } from "../03repo/mq.repo.js";
import { fetchFigiForTicker } from "../api/polygon.api.js";
import { v4 as uuidv4 } from "uuid";
import type { Root } from "@/api/generated/in/index.js";
import {
  postInternalTrack,
  type TrackRequestScanJobRoot,
} from "@/api/generated/out/index.js";

export async function processSearch(ticker: string): Promise<Root> {
  const existingJobId = inFlight.getJobIdForTicker(ticker);

  if (existingJobId) {
    return inFlight.addSubscriber(existingJobId);
  }

  let stockInfo = await db.getStock(ticker);
  if (!stockInfo) {
    const polygonData = await fetchFigiForTicker(ticker);
    stockInfo = polygonData;
    await db.saveStock(polygonData);
  }

  const cached = await cache.get(ticker);
  if (cached) {
    return cached;
  }

  const scanJobId = uuidv4();
  const trackPayload: TrackRequestScanJobRoot = {
    scanJobId,
    stockId: stockInfo.figi,
    ticker: ticker,
    priority: 9,
  };

  const trackerRes = await postInternalTrack({
    baseUrl: env.TRACKER_URL,
    body: trackPayload,
  });
  if (trackerRes.error) {
    console.error(
      "Failed to post track request:",
      JSON.stringify(trackerRes.error, null, 2)
    );
    throw new Error("Failed to initiate tracking job");
  }

  const expectedCount = trackerRes.data?.expectedArticles || 0;

  return inFlight.register(
    scanJobId,
    {
      expected: expectedCount,
      ticker,
      figi: stockInfo.figi,
      name: stockInfo.name || ticker,
    },
    () => {
      finalizeJob(scanJobId);
    },
    env.SCATTER_TIMEOUT_MS
  );
}
