import type { Candle } from "@/api/generated/dtos/candle.gen"
import type { TickerArticlesSourcesItem as SourceResult } from "@/api/generated/dtos/tickerArticlesSourcesItem.gen"

export type EventKind = "peak" | "low" | "spike"

export interface PriceEvent {
  id: string
  tSec: number
  kind: EventKind
  price: number
  articleUrls: string[]
}

export interface DetectOpts {
  windowBars?: number
  spikePct?: number
  linkWindowSec?: number
  maxEvents?: number
}

export function detectEvents(
  candles: Candle[],
  articles: SourceResult[],
  opts: DetectOpts = {}
): PriceEvent[] {
  const {
    windowBars = 5,
    spikePct = 0.02,
    linkWindowSec = 86_400,
    maxEvents,
  } = opts

  if (candles.length < 2) return []

  const events: (PriceEvent & { _significance: number })[] = []

  const globalMin = Math.min(...candles.map((c) => c.close))
  const globalMax = Math.max(...candles.map((c) => c.close))
  const globalRange = globalMax - globalMin || 1

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]!
    const prev = candles[i - 1]!
    const close = candle.close
    const prevClose = prev.close

    const ret = (close - prevClose) / prevClose

    // Local peak: higher than surrounding ±windowBars bars
    const windowStart = Math.max(0, i - windowBars)
    const windowEnd = Math.min(candles.length - 1, i + windowBars)
    const neighbours = candles.slice(windowStart, windowEnd + 1)
    const isPeak = neighbours.every((c) => c.close <= close)
    const isLow = neighbours.every((c) => c.close >= close)

    // Spike: large absolute return regardless of local extrema
    const isSpike = Math.abs(ret) >= spikePct && !isPeak && !isLow

    let kind: EventKind | null = null
    if (isPeak && i > windowBars) kind = "peak"
    else if (isLow && i > windowBars) kind = "low"
    else if (isSpike) kind = "spike"

    if (kind === null) continue

    // Dedup: skip if an event of same kind exists within windowBars bars
    const lastSameKind = events.findLast((e) => e.kind === kind)
    if (
      lastSameKind !== undefined &&
      Math.abs(candles.findIndex((c) => c.tSec === lastSameKind.tSec) - i) <=
        windowBars
    )
      continue

    const significance =
      kind === "peak"
        ? (close - globalMin) / globalRange
        : kind === "low"
          ? (globalMax - close) / globalRange
          : Math.abs(ret)

    events.push({
      id: `${candle.tSec}-${kind}`,
      tSec: candle.tSec,
      kind,
      price: close,
      articleUrls: [],
      _significance: significance,
    })
  }

  // Trim to maxEvents keeping the most significant, then restore time order
  const trimmed: PriceEvent[] =
    maxEvents != null && events.length > maxEvents
      ? events
          .slice()
          .sort((a, b) => b._significance - a._significance)
          .slice(0, maxEvents)
          .sort((a, b) => a.tSec - b.tSec)
      : events

  // Link each article to the nearest event within linkWindowSec
  for (const article of articles) {
    let nearest: { event: PriceEvent; dist: number } | null = null
    for (const event of trimmed) {
      const dist = Math.abs(article.updatedAtSec - event.tSec)
      if (dist <= linkWindowSec && (nearest === null || dist < nearest.dist)) {
        nearest = { event, dist }
      }
    }
    if (nearest !== null) {
      nearest.event.articleUrls.push(article.url)
    }
  }

  return trimmed
}

// Maps each article to the nearest candle within windowSec.
// Returns a Map from candle tSec → array of article URLs linked to that candle.
export function linkArticlesToCandles(
  candles: Candle[],
  articles: SourceResult[],
  windowSec = 86_400
): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const candle of candles) {
    map.set(candle.tSec, [])
  }

  for (const article of articles) {
    let nearest: { tSec: number; dist: number } | null = null
    for (const candle of candles) {
      const dist = Math.abs(article.updatedAtSec - candle.tSec)
      if (dist <= windowSec && (nearest === null || dist < nearest.dist)) {
        nearest = { tSec: candle.tSec, dist }
      }
    }
    if (nearest !== null) {
      map.get(nearest.tSec)!.push(article.url)
    }
  }

  return map
}
