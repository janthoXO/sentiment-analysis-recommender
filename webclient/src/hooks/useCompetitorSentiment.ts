import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import {
  getApiTickersTickerIdPeers,
  getApiTickersSentiment,
} from "@/api/generated/sentimentSearchAPI.gen"
import { readStream } from "@/lib/stream"
import type { Stock } from "@/api/generated/dtos/stock.gen"
import type { TickerResult } from "@/api/generated/dtos/tickerResult.gen"

const EAGER_COUNT = 3

export function useCompetitorSentiment(ticker: string | undefined): {
  peers: Stock[]
  resultsByTicker: Record<string, TickerResult | null>
  loadingByTicker: Record<string, boolean>
  peersLoading: boolean
  error: string | null
  loadSentiment: (ticker: string) => void
} {
  const [peers, setPeers] = useState<Stock[]>([])
  const [resultsByTicker, setResultsByTicker] = useState<
    Record<string, TickerResult | null>
  >({})
  const [loadingByTicker, setLoadingByTicker] = useState<
    Record<string, boolean>
  >({})
  const [peersLoading, setPeersLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounce batch requests: collect tickers for 50ms then fire one request
  const pendingRef = useRef<Set<string>>(new Set())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPending = useCallback(() => {
    const tickers = [...pendingRef.current]
    if (tickers.length === 0) return
    pendingRef.current = new Set()

    setLoadingByTicker((prev) => {
      const next = { ...prev }
      for (const t of tickers) next[t] = true
      return next
    })

    void (async () => {
      try {
        const res = await getApiTickersSentiment({ tickerIds: tickers })
        if (res.status !== 200) return

        await readStream(res.stream, (parsedObj) => {
          if (!("error" in parsedObj)) {
            const r = parsedObj as TickerResult
            setResultsByTicker((prev) => ({ ...prev, [r.stock.ticker]: r }))
            setLoadingByTicker((prev) => ({ ...prev, [r.stock.ticker]: false }))
          }
        })

        // Mark tickers that returned no result as done
        setResultsByTicker((prev) => {
          const next = { ...prev }
          for (const t of tickers) if (next[t] === undefined) next[t] = null
          return next
        })
      } finally {
        setLoadingByTicker((prev) => {
          const next = { ...prev }
          for (const t of tickers) next[t] = false
          return next
        })
      }
    })()
  }, [])

  const loadSentiment = useCallback(
    (t: string) => {
      // No-op if already loaded or loading
      if (resultsByTicker[t] !== undefined || loadingByTicker[t]) return
      pendingRef.current.add(t)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(flushPending, 50)
    },
    [resultsByTicker, loadingByTicker, flushPending]
  )

  useEffect(() => {
    if (!ticker) return

    const abortController = new AbortController()
    const signal = abortController.signal

    async function load() {
      setPeersLoading(true)
      setError(null)
      setPeers([])
      setResultsByTicker({})
      setLoadingByTicker({})

      try {
        const peersRes = await getApiTickersTickerIdPeers(ticker!, { signal })
        if (signal.aborted) return

        const stocks = peersRes.data ?? []
        setPeers(stocks)

        if (stocks.length === 0) return

        // Eagerly fetch the first EAGER_COUNT peers
        const eagerTickers = stocks.slice(0, EAGER_COUNT).map((s) => s.ticker)

        // Mark eager as loading; rest tickers stay undefined so loadSentiment can fetch them on demand
        const initialResults: Record<string, TickerResult | null> = {}
        const initialLoading: Record<string, boolean> = {}
        for (const t of eagerTickers) initialLoading[t] = true
        setResultsByTicker(initialResults)
        setLoadingByTicker(initialLoading)

        const eagerRes = await getApiTickersSentiment(
          { tickerIds: eagerTickers },
          { signal }
        )
        if (signal.aborted) return

        if (eagerRes.status === 200) {
          await readStream(eagerRes.stream, (parsedObj) => {
            if (signal.aborted) return
            if (!("error" in parsedObj)) {
              const r = parsedObj as TickerResult
              setResultsByTicker((prev) => ({ ...prev, [r.stock.ticker]: r }))
              setLoadingByTicker((prev) => ({
                ...prev,
                [r.stock.ticker]: false,
              }))
            }
          })
        }

        if (signal.aborted) return
        // Mark eager tickers that returned no result as done
        setResultsByTicker((prev) => {
          const next = { ...prev }
          for (const t of eagerTickers)
            if (next[t] === undefined) next[t] = null
          return next
        })
        setLoadingByTicker((prev) => {
          const next = { ...prev }
          for (const t of eagerTickers) next[t] = false
          return next
        })
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return
        if (signal.aborted) return
        const msg =
          e instanceof Error ? e.message : "Failed to load competitors"
        setError(msg)
        toast.error("Could not load competitors", { description: msg })
      } finally {
        if (!signal.aborted) setPeersLoading(false)
      }
    }

    void load()
    return () => {
      abortController.abort()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [ticker])

  return {
    peers,
    resultsByTicker,
    loadingByTicker,
    peersLoading,
    error,
    loadSentiment,
  }
}
