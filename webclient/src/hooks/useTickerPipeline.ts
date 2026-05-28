import { useState, useEffect, useMemo } from "react"
import { readStream } from "@/lib/stream"
import {
  getApiTickersTickerIdArticles,
  getApiTickersTickerIdArticlesSentiment,
} from "@/api/generated/sentimentSearchAPI.gen"
import { assertStreamOk, toastApiError } from "@/lib/api-error"
import type { TickerArticles } from "@/api/generated/dtos/tickerArticles.gen"
import type { TickerArticlesSourcesItem } from "@/api/generated/dtos/tickerArticlesSourcesItem.gen"
import type { SourceResult } from "@/api/generated/dtos/sourceResult.gen"
import type { PriceEvent } from "@/lib/events"

function computeAvg(scores: Map<string, number>): number | null {
  if (scores.size === 0) return null
  let sum = 0
  for (const v of scores.values()) sum += v
  return sum / scores.size
}

async function streamSentiment(
  ticker: string,
  articles: TickerArticlesSourcesItem[],
  onScore: (sr: SourceResult) => void,
  signal: AbortSignal
): Promise<void> {
  if (articles.length === 0) return
  const sentRes = await getApiTickersTickerIdArticlesSentiment(
    ticker,
    { articleUrl: articles.map((a) => a.url) },
    { signal }
  )
  if (signal.aborted || sentRes.status !== 200) return
  await readStream(
    (sentRes as unknown as { stream: Response }).stream,
    (parsed) => {
      if (signal.aborted) return
      if (!("error" in parsed)) onScore(parsed as SourceResult)
    }
  )
}

/** Latest-mode pipeline: fetches articles then streams sentiment for a single ticker. */
export function useTickerLatestPipeline(ticker: string | undefined): {
  articles: TickerArticlesSourcesItem[] | undefined
  scoresByUrl: Map<string, number>
  avgScore: number | null
  loading: boolean
  error: string | null
} {
  const [articles, setArticles] = useState<
    TickerArticlesSourcesItem[] | undefined
  >(undefined)
  const [scoresByUrl, setScoresByUrl] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) return
    const ctrl = new AbortController()

    async function load() {
      setArticles(undefined)
      setScoresByUrl(new Map())
      setLoading(true)
      setError(null)

      try {
        const artRes = await getApiTickersTickerIdArticles(
          ticker!,
          {},
          { signal: ctrl.signal }
        )
        if (ctrl.signal.aborted) return
        assertStreamOk(artRes, `Could not load articles for ${ticker}`)

        await readStream(
          (artRes as unknown as { stream: Response }).stream,
          (parsed) => {
            if (ctrl.signal.aborted) return
            if ("error" in parsed) return
            const ta = parsed as TickerArticles
            setArticles(ta.sources)

            if (ta.sources.length === 0) return

            // Stage 3 starts immediately for each article chunk (fire-and-forget)
            void streamSentiment(
              ticker!,
              ta.sources,
              (sr) => {
                if (ctrl.signal.aborted) return
                setScoresByUrl((prev) => {
                  const next = new Map(prev)
                  next.set(sr.url, sr.score)
                  return next
                })
              },
              ctrl.signal
            )
          }
        )
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        const msg = e instanceof Error ? e.message : "Unknown error"
        setError(msg)
        toastApiError(`Could not load ${ticker}`, e)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => ctrl.abort()
  }, [ticker])

  const avgScore = useMemo(() => computeAvg(scoresByUrl), [scoresByUrl])

  return { articles, scoresByUrl, avgScore, loading, error }
}

export interface EventPipelineEntry {
  articles: TickerArticlesSourcesItem[]
  scoresByUrl: Map<string, number>
  avgScore: number | null
}

/** Event-mode pipeline: fetches per-event articles then streams sentiment per event. */
export function useTickerEventPipeline(
  ticker: string | undefined,
  events: PriceEvent[],
  intervalSec: number | undefined
): {
  eventPipelineMap: Map<number, EventPipelineEntry>
  allArticles: TickerArticlesSourcesItem[]
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

        // Collect article lines and kick off per-event sentiment streams
        await readStream(
          (artRes as unknown as { stream: Response }).stream,
          (parsed) => {
            if (ctrl.signal.aborted) return
            if ("error" in parsed) return
            const ta = parsed as TickerArticles & { eventTSec?: number }
            if (ta.eventTSec == null) return

            const tSec = ta.eventTSec
            const eventArticles = ta.sources

            setEventPipelineMap((prev) => {
              const next = new Map(prev)
              next.set(tSec, {
                articles: eventArticles,
                scoresByUrl: new Map(),
                avgScore: null,
              })
              return next
            })

            // Stream sentiment for this event's articles
            void streamSentiment(
              ticker!,
              eventArticles,
              (sr) => {
                if (ctrl.signal.aborted) return
                setEventPipelineMap((prev) => {
                  const next = new Map(prev)
                  const entry = next.get(tSec)
                  if (!entry) return prev
                  const newScores = new Map(entry.scoresByUrl)
                  newScores.set(sr.url, sr.score)
                  next.set(tSec, {
                    ...entry,
                    scoresByUrl: newScores,
                    avgScore: computeAvg(newScores),
                  })
                  return next
                })
              },
              ctrl.signal
            )
          }
        )
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
    const result: TickerArticlesSourcesItem[] = []
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
