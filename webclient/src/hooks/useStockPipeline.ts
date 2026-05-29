import { useState, useCallback, useRef } from "react"
import type { Stock } from "@/models/Stock"
import type { Article } from "@/models/Article"
import type { SourceResult } from "@/api/generated/dtos/sourceResult.gen"
import type { SearchError } from "@/api/generated/dtos/searchError.gen"
import { computeAvg } from "@/lib/avg-score"
import { toastApiError } from "@/lib/api-error"

export type StockSource = (
  signal: AbortSignal
) => AsyncIterable<Stock | SearchError>
export type ArticleSource = (
  ticker: string,
  signal: AbortSignal
) => AsyncIterable<Article[] | SearchError>
export type SentimentSource = (
  ticker: string,
  urls: string[],
  signal: AbortSignal
) => AsyncIterable<SourceResult | SearchError>

export type TickerStage = "stock" | "articles" | "sentiment" | "done"

export interface TickerState {
  stock: Stock
  stage: TickerStage
  error?: string
}

export interface UseStockPipelineReturn {
  resultsByTicker: Map<string, TickerState>
  order: string[]
  loading: boolean
  error: string | null
  /** Start a new pipeline run, aborting any previous one. */
  run: (stocks: StockSource) => void
  /** Abort the current run without starting a new one. */
  reset: () => void
}

export function useStockPipeline({
  articles,
  sentiment,
}: {
  articles: ArticleSource
  sentiment: SentimentSource
}): UseStockPipelineReturn {
  const [resultsByTicker, setResultsByTicker] = useState<
    Map<string, TickerState>
  >(new Map())
  const [order, setOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(
    (stocks: StockSource) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const runId = ++runIdRef.current
      const { signal } = ctrl

      setResultsByTicker(new Map())
      setOrder([])
      setLoading(true)
      setError(null)

      const isCurrent = () => !signal.aborted && runIdRef.current === runId

      async function runSentimentChunk(ticker: string, urls: string[]) {
        try {
          for await (const item of sentiment(ticker, urls, signal)) {
            if (!isCurrent()) return
            if ("error" in item) continue
            const sr = item as SourceResult
            setResultsByTicker((prev) => {
              if (!isCurrent()) return prev
              const next = new Map(prev)
              const s = next.get(ticker)
              if (!s?.stock.articles) return prev
              const newArticles = s.stock.articles.map((a) =>
                a.url === sr.url ? { ...a, score: sr.score } : a
              )
              next.set(ticker, {
                ...s,
                stock: {
                  ...s.stock,
                  articles: newArticles,
                  avgScore: computeAvg(newArticles),
                },
                stage: newArticles.every((a) => a.score != null)
                  ? "done"
                  : "sentiment",
              })
              return next
            })
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return
          toastApiError(`Sentiment failed for ${ticker}`, e)
        }
      }

      async function runArticlesSentiment(stock: Stock) {
        const { ticker } = stock
        setResultsByTicker((prev) => {
          if (!isCurrent()) return prev
          const next = new Map(prev)
          const s = next.get(ticker)
          if (s) next.set(ticker, { ...s, stage: "articles" })
          return next
        })

        try {
          for await (const chunk of articles(ticker, signal)) {
            if (!isCurrent()) return
            if ("error" in chunk) {
              const err = chunk as SearchError
              setResultsByTicker((prev) => {
                if (!isCurrent()) return prev
                const next = new Map(prev)
                const s = next.get(ticker)
                if (s)
                  next.set(ticker, { ...s, stage: "done", error: err.error })
                return next
              })
              return
            }
            const sources = chunk as Article[]
            setResultsByTicker((prev) => {
              if (!isCurrent()) return prev
              const next = new Map(prev)
              const s = next.get(ticker)
              if (s)
                next.set(ticker, {
                  ...s,
                  stock: { ...s.stock, articles: sources },
                  stage: sources.length === 0 ? "done" : "sentiment",
                })
              return next
            })
            if (sources.length > 0) {
              void runSentimentChunk(
                ticker,
                sources.map((a) => a.url)
              )
            }
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return
          toastApiError(`Articles failed for ${ticker}`, e)
          setResultsByTicker((prev) => {
            if (!isCurrent()) return prev
            const next = new Map(prev)
            const s = next.get(ticker)
            if (s) next.set(ticker, { ...s, stage: "done", error: String(e) })
            return next
          })
        }
      }

      void (async () => {
        try {
          for await (const item of stocks(signal)) {
            if (!isCurrent()) return
            if ("error" in item) {
              const err = item as SearchError
              if (!err.ticker) {
                setError(err.error)
              } else {
                setResultsByTicker((prev) => {
                  if (!isCurrent()) return prev
                  const next = new Map(prev)
                  const s = next.get(err.ticker!)
                  if (s)
                    next.set(err.ticker!, {
                      ...s,
                      stage: "done",
                      error: err.error,
                    })
                  return next
                })
              }
              continue
            }
            const stock = item as Stock
            setOrder((prev) => [...prev, stock.ticker])
            setResultsByTicker((prev) => {
              if (!isCurrent()) return prev
              const next = new Map(prev)
              next.set(stock.ticker, { stock, stage: "stock" })
              return next
            })
            void runArticlesSentiment(stock)
          }
        } catch (e) {
          if (
            signal.aborted ||
            (e instanceof DOMException && e.name === "AbortError")
          )
            return
          const msg = e instanceof Error ? e.message : "Unknown error"
          if (isCurrent()) setError(msg)
          toastApiError("Search failed", e)
        } finally {
          if (isCurrent()) setLoading(false)
        }
      })()
    },
    [articles, sentiment]
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { resultsByTicker, order, loading, error, run, reset }
}
