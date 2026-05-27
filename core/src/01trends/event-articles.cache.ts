import { getRedis } from "@/cache.repo.js";
import type { SourceRoot } from "@/generated/in/index.js";

// Events are historical; their article set doesn't change once the window has passed.
const TTL = 86_400;

const key = (ticker: string, eventTSec: number, intervalSec: number) =>
  `event-articles:${ticker}:${eventTSec}:${intervalSec}`;

export async function getEventArticlesCache(
  ticker: string,
  eventTSec: number,
  intervalSec: number
): Promise<SourceRoot[] | null> {
  const data = await getRedis().get(key(ticker, eventTSec, intervalSec));
  return data ? (JSON.parse(data) as SourceRoot[]) : null;
}

export async function setEventArticlesCache(
  ticker: string,
  eventTSec: number,
  intervalSec: number,
  articles: SourceRoot[]
): Promise<void> {
  await getRedis().set(
    key(ticker, eventTSec, intervalSec),
    JSON.stringify(articles),
    "EX",
    TTL
  );
}
