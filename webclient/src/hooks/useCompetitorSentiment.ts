import { useState, useEffect, useCallback, useRef } from "react"
import {
  getApiTickersTickerIdPeers,
  getApiTickersTickerIdArticles,
  getApiTickersTickerIdArticlesSentiment,
} from "@/api/generated/sentimentSearchAPI.gen"
import { readStream } from "@/lib/stream"
import type { Stock } from "@/api/generated/dtos/stock.gen"
import type { TickerArticles } from "@/api/generated/dtos/tickerArticles.gen"
import type { SourceResult } from "@/api/generated/dtos/sourceResult.gen"
import { assertStreamOk, toastApiError } from "@/lib/api-error"

const EAGER_COUNT = 3

export interface CompetitorState {
  stock: Stock
  articles: TickerArticles["sources"] | undefined
  scoresByUrl: Map<string, number>
  avgScore: number | null
  loading: boolean
}

function computeAvg(scores: Map<string, number>): number | null {
  if (scores.size === 0) return null
  let sum = 0
  for (const v of scores.values()) sum += v
  return sum / scores.size
}

/** Runs stages 2+3 for a ticker whose Stock is already known. */
async function runArticlesSentimentForTicker(
  ticker: string,
  onArticles: (articles: TickerArticles["sources"]) => void,
  onScore: (sr: SourceResult) => void,
  onDone: () => void,
  signal: AbortSignal
): Promise<void> {
  try {
    const artRes = await getApiTickersTickerIdArticles(ticker, {}, { signal })
    if (signal.aborted || artRes.status !== 200) return

    await readStream(
      (artRes as unknown as { stream: Response }).stream,
      (parsed) => {
        if (signal.aborted) return
        if ("error" in parsed) return
        const ta = parsed as TickerArticles
        onArticles(ta.sources)

        if (ta.sources.length === 0) {
          onDone()
          return
        }

        // Stage 3: sentiment starts immediately for each article chunk
        void (async () => {
          try {
            const sentRes = await getApiTickersTickerIdArticlesSentiment(
              ticker,
              { articleUrl: ta.sources.map((s) => s.url) },
              { signal }
            )
            if (signal.aborted || sentRes.status !== 200) return
            await readStream(
              (sentRes as unknown as { stream: Response }).stream,
              (p) => {
                if (signal.aborted || "error" in p) return
                onScore(p as SourceResult)
              }
            )
          } finally {
            onDone()
          }
        })()
      }
    )
  } catch {
    // silently ignore per-ticker failures in competitor view
    onDone()
  }
}

export function useCompetitorSentiment(ticker: string | undefined): {
  peers: Stock[]
  stateByTicker: Record<string, CompetitorState>
  peersLoading: boolean
  error: string | null
  loadSentiment: (ticker: string) => void
} {
  const [peers, setPeers] = useState<Stock[]>([])
  const [stateByTicker, setStateByTicker] = useState<
    Record<string, CompetitorState>
  >({})
  const [peersLoading, setPeersLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const peersRef = useRef<Stock[]>([])

  const startPipelineForTicker = useCallback(
    (stock: Stock, signal: AbortSignal) => {
      const t = stock.ticker
      setStateByTicker((prev) => ({
        ...prev,
        [t]: prev[t] ?? {
          stock,
          articles: undefined,
          scoresByUrl: new Map(),
          avgScore: null,
          loading: true,
        },
      }))

      void runArticlesSentimentForTicker(
        t,
        (articles) =>
          setStateByTicker((prev) => ({
            ...prev,
            [t]: { ...prev[t]!, articles },
          })),
        (sr) =>
          setStateByTicker((prev) => {
            const s = prev[t]
            if (!s) return prev
            const newScores = new Map(s.scoresByUrl)
            newScores.set(sr.url, sr.score)
            return {
              ...prev,
              [t]: {
                ...s,
                scoresByUrl: newScores,
                avgScore: computeAvg(newScores),
              },
            }
          }),
        () =>
          setStateByTicker((prev) =>
            prev[t] ? { ...prev, [t]: { ...prev[t]!, loading: false } } : prev
          ),
        signal
      )
    },
    []
  )

  const loadSentiment = useCallback(
    (t: string) => {
      if (stateByTicker[t] !== undefined) return
      const stock = peersRef.current.find((s) => s.ticker === t)
      if (!stock) return
      const signal = abortRef.current?.signal ?? new AbortController().signal
      startPipelineForTicker(stock, signal)
    },
    [stateByTicker, startPipelineForTicker]
  )

  useEffect(() => {
    if (!ticker) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const signal = ctrl.signal

    async function load() {
      setPeersLoading(true)
      setError(null)
      setPeers([])
      setStateByTicker({})
      peersRef.current = []

      try {
        const peersRes = await getApiTickersTickerIdPeers(ticker!, { signal })
        if (signal.aborted) return
        assertStreamOk(peersRes, "Could not load competitors")

        let eagerCount = 0

        await readStream(
          (peersRes as unknown as { stream: Response }).stream,
          (parsed) => {
            if (signal.aborted) return
            if ("error" in parsed) return
            const stock = parsed as Stock

            peersRef.current = [...peersRef.current, stock]
            setPeers((prev) => [...prev, stock])

            // Immediately start the pipeline for the first EAGER_COUNT peers as each arrives
            if (eagerCount < EAGER_COUNT) {
              eagerCount++
              startPipelineForTicker(stock, signal)
            }
          }
        )
      } catch (e: unknown) {
        if (signal.aborted) return
        const msg =
          e instanceof Error ? e.message : "Failed to load competitors"
        setError(msg)
        toastApiError("Could not load competitors", e)
      } finally {
        if (!signal.aborted) setPeersLoading(false)
      }
    }

    void load()
    return () => ctrl.abort()
  }, [ticker, startPipelineForTicker])

  return { peers, stateByTicker, peersLoading, error, loadSentiment }
}
