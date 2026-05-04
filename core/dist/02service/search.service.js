import * as inFlight from "../02service/inFlight.service.js";
import * as cache from "../03repo/cache.repo.js";
import * as db from "../03repo/postgres.repo.js";
import { env } from "../env.js";
import { finalizeJob } from "../03repo/mq.repo.js";
import { fetchFigiForTicker } from "../api/polygon.api.js";
import { v4 as uuidv4 } from "uuid";
import { postInternalTrack } from "../api/generated/sdk.gen.js";
export async function processSearch(ticker) {
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
    const trackPayload = {
        scanJobId,
        stockId: stockInfo.figi,
        ticker: ticker,
        interval: 0,
        ttl: 0,
    };
    const trackerRes = await postInternalTrack({ body: trackPayload });
    if (trackerRes.error) {
        throw new Error("Tracker failed to accept track payload");
    }
    const expectedCount = trackerRes.data?.expectedArticles || 0;
    return inFlight.register(scanJobId, {
        expected: expectedCount,
        ticker,
        figi: stockInfo.figi,
        name: stockInfo.name || ticker,
    }, () => {
        finalizeJob(scanJobId);
    }, env.SCATTER_TIMEOUT_MS);
}
//# sourceMappingURL=search.service.js.map