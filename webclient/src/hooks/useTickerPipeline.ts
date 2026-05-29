import { useState, useEffect, useMemo } from "react"
import { readNdjson } from "@/lib/ndjson"
import { getApiTickersTickerIdArticles } from "@/api/generated/sentimentSearchAPI.gen"
import { assertStreamOk, toastApiError } from "@/lib/api-error"
import type { TickerArticles } from "@/api/generated/dtos/tickerArticles.gen"
import type { SearchError } from "@/api/generated/dtos/searchError.gen"
import type { PriceEvent } from "@/lib/events"
import type { Article } from "@/models/Article"
import { computeAvg } from "@/lib/avg-score"
import { useStockPipeline } from "@/hooks/useStockPipeline"
import {
  passthroughStocksSource,
  articlesSource,
  sentimentSource,
  mapArticles,
} from "@/hooks/sources"

/** Latest-mode pipeline: fetches articles then streams sentiment for a single ticker. */
export function useTickerLatestPipeline(ticker: string | undefined): {
  articles: Article[] | undefined
  avgScore: number | undefined
  loading: boolean
  error: string | null
} {
  const pipeline = useStockPipeline({
    articles: articlesSource,
    sentiment: sentimentSource,
  })
  const { run, reset } = pipeline

  useEffect(() => {
    if (!ticker) return
    run(passthroughStocksSource([{ ticker, name: ticker }]))
    return () => reset()
  }, [ticker, run, reset])

  const state = ticker ? pipeline.resultsByTicker.get(ticker) : undefined
  const articles = state?.stock.articles
  const avgScore = state?.stock.avgScore
  const loading = !state || state.stage !== "done"

  return {
    articles,
    avgScore,
    loading,
    error: state?.error ?? pipeline.error,
  }
}

export interface EventPipelineEntry {
  articles: Article[]
  avgScore: number | undefined
}

/** Event-mode pipeline: fetches per-event articles then streams sentiment per event. */
export function useTickerEventPipeline(
  ticker: string | undefined,
  events: PriceEvent[],
  intervalSec: number | undefined
): {
  eventPipelineMap: Map<number, EventPipelineEntry>
  allArticles: Article[]
  loading: boolean
  error: string | null
} {
  const [eventPipelineMap, setEventPipelineMap] = useState<
    Map<number, EventPipelineEntry>
  >(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eventTSecs = useMemo(() => events.map((e) => e.tSec), [events])

  useEffect(() => {
    if (!ticker || eventTSecs.length === 0 || intervalSec == null) return

    const ctrl = new AbortController()

    async function load() {
      setEventPipelineMap(new Map())
      setLoading(true)
      setError(null)

      try {
        const artRes = await getApiTickersTickerIdArticles(
          ticker!,
          { eventTSec: eventTSecs, intervalSec },
          { signal: ctrl.signal }
        )
        if (ctrl.signal.aborted) return
        assertStreamOk(artRes, "Could not load event articles")

        for await (const item of readNdjson<
          (TickerArticles & { eventTSec?: number }) | SearchError
        >((artRes as unknown as { stream: Response }).stream, ctrl.signal)) {
          if (ctrl.signal.aborted) return
          if ("error" in item) continue
          const ta = item as TickerArticles & { eventTSec?: number }
          if (ta.eventTSec == null) continue

          const tSec = ta.eventTSec
          const eventArticles = mapArticles(ta.sources)

          setEventPipelineMap((prev) => {
            const next = new Map(prev)
            next.set(tSec, { articles: eventArticles, avgScore: undefined })
            return next
          })

          void (async () => {
            try {
              for await (const item of sentimentSource(
                ticker!,
                eventArticles.map((a) => a.url),
                ctrl.signal
              )) {
                if (ctrl.signal.aborted) return
                if ("error" in item) continue
                const sr = item
                setEventPipelineMap((prev) => {
                  const next = new Map(prev)
                  const entry = next.get(tSec)
                  if (!entry) return prev
                  const updatedArticles = entry.articles.map((a) =>
                    a.url === sr.url ? { ...a, score: sr.score } : a
                  )
                  next.set(tSec, {
                    articles: updatedArticles,
                    avgScore: computeAvg(updatedArticles),
                  })
                  return next
                })
              }
            } catch (e) {
              if (e instanceof DOMException && e.name === "AbortError") return
              toastApiError("Could not load event sentiment", e)
            }
          })()
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        const msg = e instanceof Error ? e.message : "Unknown error"
        setError(msg)
        toastApiError("Could not load event sentiment", e)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => ctrl.abort()
  }, [ticker, eventTSecs, intervalSec])

  const allArticles = useMemo(() => {
    const seen = new Set<string>()
    const result: Article[] = []
    for (const entry of eventPipelineMap.values()) {
      for (const a of entry.articles) {
        if (!seen.has(a.url)) {
          seen.add(a.url)
          result.push(a)
        }
      }
    }
    return result
  }, [eventPipelineMap])

  return { eventPipelineMap, allArticles, loading, error }
}
