import { useState, useEffect, useCallback, useRef } from "react"
import {
  getApiTickersTickerIdPeers,
  getApiTickersSentiment,
} from "@/api/generated/sentimentSearchAPI.gen"
import { readStream } from "@/lib/stream"
import type { Stock } from "@/api/generated/dtos/stock.gen"
import type { TickerResult } from "@/api/generated/dtos/tickerResult.gen"
import { assertOk, toastApiError } from "@/lib/api-error"

const EAGER_COUNT = 3

export function useCompetitorSentiment(ticker: string | undefined): {
  peers: Stock[]
  resultsByTicker: Record<string, TickerResult | null>
  loadingByTicker: Record<string, boolean>
  errorsByTicker: Record<string, string>
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
  const [errorsByTicker, setErrorsByTicker] = useState<Record<string, string>>(
    {}
  )
  const [peersLoading, setPeersLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          if ("error" in parsedObj) {
            const chunk = parsedObj as { error: string; ticker?: string }
            if (chunk.ticker) {
              setErrorsByTicker((prev) => ({
                ...prev,
                [chunk.ticker!]: chunk.error,
              }))
              setResultsByTicker((prev) => ({
                ...prev,
                [chunk.ticker!]: null,
              }))
              setLoadingByTicker((prev) => ({
                ...prev,
                [chunk.ticker!]: false,
              }))
            }
            return
          }
          const r = parsedObj as TickerResult
          setResultsByTicker((prev) => ({ ...prev, [r.stock.ticker]: r }))
          setLoadingByTicker((prev) => ({ ...prev, [r.stock.ticker]: false }))
        })

        setResultsByTicker((prev) => {
          const next = { ...prev }
          for (const t of tickers) if (next[t] === undefined) next[t] = null
          return next
        })
      } catch (e) {
        toastApiError("Could not load competitor sentiment", e)
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
      setErrorsByTicker({})

      try {
        const peersRes = await getApiTickersTickerIdPeers(ticker!, { signal })
        if (signal.aborted) return

        const stocks =
          assertOk<Stock[]>(peersRes, "Could not load competitors") ?? []
        setPeers(stocks)

        if (stocks.length === 0) return

        const eagerTickers = stocks.slice(0, EAGER_COUNT).map((s) => s.ticker)

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
            if ("error" in parsedObj) {
              const chunk = parsedObj as { error: string; ticker?: string }
              if (chunk.ticker) {
                setErrorsByTicker((prev) => ({
                  ...prev,
                  [chunk.ticker!]: chunk.error,
                }))
                setResultsByTicker((prev) => ({
                  ...prev,
                  [chunk.ticker!]: null,
                }))
                setLoadingByTicker((prev) => ({
                  ...prev,
                  [chunk.ticker!]: false,
                }))
              }
              return
            }
            const r = parsedObj as TickerResult
            setResultsByTicker((prev) => ({ ...prev, [r.stock.ticker]: r }))
            setLoadingByTicker((prev) => ({
              ...prev,
              [r.stock.ticker]: false,
            }))
          })
        }

        if (signal.aborted) return
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
    return () => {
      abortController.abort()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [ticker])

  return {
    peers,
    resultsByTicker,
    loadingByTicker,
    errorsByTicker,
    peersLoading,
    error,
    loadSentiment,
  }
}
