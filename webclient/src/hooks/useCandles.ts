import { useState, useEffect } from "react"
import { toast } from "sonner"
import { getApiTickersTickerIdCandles } from "@/api/generated/sentimentSearchAPI.gen"
import type { Candle } from "@/api/generated/dtos/candle.gen"
import type { CandleDuration, CandleInterval } from "@/lib/intervals"

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

        if (res.status !== 200) {
          throw new Error("Failed to fetch candles")
        }

        const series = res.data as { candles: Candle[] }
        setCandles(series.candles ?? [])
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return
        if (signal.aborted) return
        const msg = e instanceof Error ? e.message : "Failed to load chart data"
        setError(msg)
        toast.error("Could not load price chart", { description: msg })
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => abortController.abort()
  }, [ticker, duration, interval])

  return { candles, loading, error }
}
