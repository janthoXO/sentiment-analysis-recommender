import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { readNdjson } from "@/lib/ndjson"
import { assertStreamOk, toastApiError } from "@/lib/api-error"
import { getApiTickersTickerIdPeers } from "@/api/generated/sentimentSearchAPI.gen"
import type { Stock as ApiStock } from "@/api/generated/dtos/stock.gen"
import type { SearchError } from "@/api/generated/dtos/searchError.gen"
import { useStockPipeline } from "@/hooks/useStockPipeline"
import {
  passthroughStocksSource,
  articlesSource,
  sentimentSource,
} from "@/hooks/sources"
import type { Stock } from "@/models/Stock"

const EAGER_COUNT = 3

export interface CompetitorState {
  stock: Stock
  loading: boolean
}

export function useCompetitorSentiment(ticker: string | undefined): {
  peers: Stock[]
  stateByTicker: Record<string, CompetitorState>
  peersLoading: boolean
  error: string | null
  loadSentiment: (ticker: string) => void
} {
  const [peers, setPeers] = useState<Stock[]>([])
  const [peersLoading, setPeersLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const peersRef = useRef<Stock[]>([])

  const eagerPipeline = useStockPipeline({
    articles: articlesSource,
    sentiment: sentimentSource,
  })
  const lazyPipeline = useStockPipeline({
    articles: articlesSource,
    sentiment: sentimentSource,
  })

  // Batch all loadSentiment calls in one tick into a single lazyPipeline.run()
  const lazyPendingRef = useRef<Set<string>>(new Set())
  const lazyFlushScheduled = useRef(false)

  const eagerRun = eagerPipeline.run
  const eagerReset = eagerPipeline.reset
  const lazyRun = lazyPipeline.run
  const lazyReset = lazyPipeline.reset

  const loadSentiment = useCallback(
    (t: string) => {
      if (lazyPipeline.resultsByTicker.has(t) || lazyPendingRef.current.has(t))
        return
      lazyPendingRef.current.add(t)
      if (!lazyFlushScheduled.current) {
        lazyFlushScheduled.current = true
        queueMicrotask(() => {
          lazyFlushScheduled.current = false
          const tickers = [...lazyPendingRef.current]
          lazyPendingRef.current = new Set()
          const stocks = tickers
            .map((id) => peersRef.current.find((s) => s.ticker === id))
            .filter((s): s is Stock => s != null)
          if (stocks.length > 0) lazyRun(passthroughStocksSource(stocks))
        })
      }
    },
    [lazyPipeline.resultsByTicker, lazyRun]
  )

  useEffect(() => {
    if (!ticker) return

    peersRef.current = []
    lazyPendingRef.current = new Set()
    const ctrl = new AbortController()

    void (async () => {
      setPeers([])
      setPeersLoading(true)
      setError(null)
      try {
        const res = await getApiTickersTickerIdPeers(ticker, {
          signal: ctrl.signal,
        })
        if (ctrl.signal.aborted) return
        assertStreamOk(res, "Could not load competitors")

        for await (const item of readNdjson<ApiStock | SearchError>(
          (res as unknown as { stream: Response }).stream,
          ctrl.signal
        )) {
          if (ctrl.signal.aborted) return
          if ("error" in item) continue
          const stock = item as Stock
          peersRef.current = [...peersRef.current, stock]
          setPeers((prev) => [...prev, stock])
        }

        if (ctrl.signal.aborted) return
        const eagerPeers = peersRef.current.slice(0, EAGER_COUNT)
        if (eagerPeers.length > 0) eagerRun(passthroughStocksSource(eagerPeers))
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg =
          e instanceof Error ? e.message : "Failed to load competitors"
        setError(msg)
        toastApiError("Could not load competitors", e)
      } finally {
        if (!ctrl.signal.aborted) setPeersLoading(false)
      }
    })()

    return () => {
      ctrl.abort()
      eagerReset()
      lazyReset()
    }
  }, [ticker, eagerRun, eagerReset, lazyReset])

  const stateByTicker = useMemo(() => {
    const merged: Record<string, CompetitorState> = {}
    for (const [t, s] of eagerPipeline.resultsByTicker) {
      merged[t] = { stock: s.stock, loading: s.stage !== "done" }
    }
    for (const [t, s] of lazyPipeline.resultsByTicker) {
      merged[t] = { stock: s.stock, loading: s.stage !== "done" }
    }
    return merged
  }, [eagerPipeline.resultsByTicker, lazyPipeline.resultsByTicker])

  return {
    peers,
    stateByTicker,
    peersLoading,
    error: error ?? eagerPipeline.error,
    loadSentiment,
  }
}
