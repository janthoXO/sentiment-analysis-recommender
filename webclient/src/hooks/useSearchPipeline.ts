import { useState, useCallback, useRef } from "react"
import { readStream } from "@/lib/stream"
import {
  getApiTickers,
  getApiTickersTrending,
  getApiTickersTickerIdArticles,
  getApiTickersTickerIdArticlesSentiment,
} from "@/api/generated/sentimentSearchAPI.gen"
import { assertStreamOk, toastApiError } from "@/lib/api-error"
import type { Stock } from "@/api/generated/dtos/stock.gen"
import type { TickerArticles } from "@/api/generated/dtos/tickerArticles.gen"
import type { TickerArticlesSourcesItem } from "@/api/generated/dtos/tickerArticlesSourcesItem.gen"
import type { SourceResult } from "@/api/generated/dtos/sourceResult.gen"
import type { SearchError } from "@/api/generated/dtos/searchError.gen"

export type TickerStage = "stock" | "articles" | "sentiment" | "done"

export interface TickerState {
  stock: Stock
  articles: TickerArticlesSourcesItem[] | undefined
  scoresByUrl: Map<string, number>
  avgScore: number | null
  stage: TickerStage
  error?: string
}

type PipelineInput =
  | { q: string }
  | { tickerIds: string[] }
  | { trending: true }

function computeAvg(scores: Map<string, number>): number | null {
  if (scores.size === 0) return null
  let sum = 0
  for (const v of scores.values()) sum += v
  return sum / scores.size
}

export function useSearchPipeline(): {
  resultsByTicker: Map<string, TickerState>
  order: string[]
  loading: boolean
  error: string | null
  search: (input: PipelineInput) => void
  restart: () => void
} {
  const [resultsByTicker, setResultsByTicker] = useState<
    Map<string, TickerState>
  >(new Map())
  const [order, setOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback((input: PipelineInput) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const runId = ++runIdRef.current

    setResultsByTicker(new Map())
    setOrder([])
    setLoading(true)
    setError(null)

    // Starts articles+sentiment pipeline for a single stock as soon as it arrives (stage 1 onLine)
    function startTickerPipeline(stock: Stock) {
      const ticker = stock.ticker

      setOrder((prev) => [...prev, ticker])
      setResultsByTicker((prev) => {
        const next = new Map(prev)
        next.set(ticker, {
          stock,
          articles: undefined,
          scoresByUrl: new Map(),
          avgScore: null,
          stage: "stock",
        })
        return next
      })

      // Stage 2: articles for this ticker
      void (async () => {
        try {
          const artRes = await getApiTickersTickerIdArticles(
            ticker,
            {},
            { signal: ctrl.signal }
          )
          if (ctrl.signal.aborted || runIdRef.current !== runId) return
          if (artRes.status !== 200) return

          setResultsByTicker((prev) => {
            const next = new Map(prev)
            const s = next.get(ticker)
            if (s) next.set(ticker, { ...s, stage: "articles" })
            return next
          })

          await readStream(
            (artRes as unknown as { stream: Response }).stream,
            (parsed) => {
              if (ctrl.signal.aborted || runIdRef.current !== runId) return
              if ("error" in parsed) {
                const err = parsed as SearchError
                if (err.ticker || !("ticker" in parsed)) {
                  setResultsByTicker((prev) => {
                    const next = new Map(prev)
                    const s = next.get(ticker)
                    if (s)
                      next.set(ticker, {
                        ...s,
                        stage: "done",
                        error: err.error,
                      })
                    return next
                  })
                }
                return
              }

              const ta = parsed as TickerArticles
              const sources = ta.sources

              setResultsByTicker((prev) => {
                const next = new Map(prev)
                const s = next.get(ticker)
                if (s)
                  next.set(ticker, {
                    ...s,
                    articles: sources,
                    stage: sources.length === 0 ? "done" : "sentiment",
                  })
                return next
              })

              if (sources.length === 0) return

              // Stage 3: sentiment for this article batch (fire-and-forget per chunk)
              void (async () => {
                try {
                  const sentRes = await getApiTickersTickerIdArticlesSentiment(
                    ticker,
                    { articleUrl: sources.map((s) => s.url) },
                    { signal: ctrl.signal }
                  )
                  if (ctrl.signal.aborted || runIdRef.current !== runId) return
                  if (sentRes.status !== 200) return

                  await readStream(
                    (sentRes as unknown as { stream: Response }).stream,
                    (parsed) => {
                      if (ctrl.signal.aborted || runIdRef.current !== runId)
                        return
                      if ("error" in parsed) return
                      const sr = parsed as SourceResult

                      setResultsByTicker((prev) => {
                        const next = new Map(prev)
                        const s = next.get(ticker)
                        if (!s) return prev
                        const newScores = new Map(s.scoresByUrl)
                        newScores.set(sr.url, sr.score)
                        const allScored =
                          s.articles && newScores.size >= s.articles.length
                        return (
                          next.set(ticker, {
                            ...s,
                            scoresByUrl: newScores,
                            avgScore: computeAvg(newScores),
                            stage: allScored ? "done" : "sentiment",
                          }),
                          next
                        )
                      })
                    }
                  )
                } catch (e) {
                  if (e instanceof DOMException && e.name === "AbortError")
                    return
                  toastApiError(`Sentiment failed for ${ticker}`, e)
                }
              })()
            }
          )
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return
          toastApiError(`Articles failed for ${ticker}`, e)
        }
      })()
    }

    void (async () => {
      try {
        // ── Stage 1: stream stocks ────────────────────────────────────────
        let stocksRes:
          | Awaited<ReturnType<typeof getApiTickers>>
          | Awaited<ReturnType<typeof getApiTickersTrending>>

        if ("trending" in input) {
          stocksRes = await getApiTickersTrending({ signal: ctrl.signal })
        } else {
          stocksRes = await getApiTickers(
            "q" in input ? { q: input.q } : { tickerIds: input.tickerIds },
            { signal: ctrl.signal }
          )
        }

        if (ctrl.signal.aborted || runIdRef.current !== runId) return
        assertStreamOk(stocksRes, "Search failed")

        await readStream(
          (stocksRes as unknown as { stream: Response }).stream,
          (parsed) => {
            if (ctrl.signal.aborted || runIdRef.current !== runId) return
            if ("error" in parsed) {
              const err = parsed as SearchError
              if (!err.ticker) setError(err.error)
              return
            }
            // Each stock immediately kicks stages 2 and 3
            startTickerPipeline(parsed as Stock)
          }
        )
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        const msg = e instanceof Error ? e.message : "Unknown error"
        setError(msg)
        toastApiError("Search failed", e)
      } finally {
        if (runIdRef.current === runId) setLoading(false)
      }
    })()
  }, [])

  const restart = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { resultsByTicker, order, loading, error, search, restart }
}
