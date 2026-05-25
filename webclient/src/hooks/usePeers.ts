import { useState, useEffect } from "react"
import {
  getApiTickersTickerIdPeers,
  getApiTickers,
} from "@/api/generated/sentimentSearchAPI.gen"
import type { Stock, TickerResult } from "@/api/generated/dtos"

export type PeerRow = { stock: Stock; result: TickerResult | null }

export function usePeers(ticker: string | undefined): {
  peers: PeerRow[]
  loading: boolean
  error: string | null
} {
  const [peers, setPeers] = useState<PeerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) return

    const abortController = new AbortController()
    const signal = abortController.signal

    async function load(ticker: string) {
      setLoading(true)
      setError(null)
      setPeers([])

      try {
        const peersRes = await getApiTickersTickerIdPeers(ticker, { signal })
        if (signal.aborted) return

        const stocks = peersRes.data
        if (!stocks || stocks.length === 0) return

        // Show peer names immediately while sentiment loads
        setPeers(stocks.map((stock) => ({ stock, result: null })))

        const tickersRes = await getApiTickers(
          { tickers: stocks.map((s) => s.ticker).join(",") },
          { signal }
        )
        if (signal.aborted) return

        const resultMap = new Map(
          tickersRes.data.map((r) => [r.stock.ticker, r])
        )

        setPeers(
          stocks.map((stock) => ({
            stock,
            result: resultMap.get(stock.ticker) ?? null,
          }))
        )
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return
        const msg =
          e instanceof Error ? e.message : "Failed to load competitors"
        setError(msg)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void load(ticker)
    return () => abortController.abort()
  }, [ticker])

  return { peers, loading, error }
}
