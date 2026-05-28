import { useState, useEffect } from "react"
import { getApiTickersTickerIdCandles } from "@/api/generated/sentimentSearchAPI.gen"
import type { Candle } from "@/api/generated/dtos/candle.gen"
import type { CandleDuration, CandleInterval } from "@/lib/intervals"
import { assertOk, toastApiError } from "@/lib/api-error"

export function useCandles(
  ticker: string | undefined,
  duration: CandleDuration | undefined,
  interval: CandleInterval | undefined
): {
  candles: Candle[]
  loading: boolean
  error: string | null
} {
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker || !duration || !interval) return

    const abortController = new AbortController()
    const signal = abortController.signal

    async function load() {
      setLoading(true)
      setError(null)
      setCandles([])

      try {
        const res = await getApiTickersTickerIdCandles(
          ticker!,
          { duration: duration!, interval: interval! },
          { signal }
        )
        if (signal.aborted) return

        const data = assertOk<{ candles: Candle[] }>(
          res,
          "Could not load price chart"
        )
        setCandles(data.candles ?? [])
      } catch (e: unknown) {
        if (signal.aborted) return
        const msg = e instanceof Error ? e.message : "Failed to load chart data"
        setError(msg)
        toastApiError("Could not load price chart", e)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => abortController.abort()
  }, [ticker, duration, interval])

  return { candles, loading, error }
}
