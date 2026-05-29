import { useState, useEffect } from "react"
import { readStream } from "@/lib/stream"
import { getApiTickersTickerIdSentiment } from "@/api/generated/sentimentSearchAPI.gen"
import type { TickerResult } from "@/api/generated/dtos"
import { assertStreamOk, toastApiError } from "@/lib/api-error"

export function useTickerSentiment(ticker: string | undefined): {
  data: TickerResult | null
  loading: boolean
  error: string | null
} {
  const [data, setData] = useState<TickerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) return

    const abortController = new AbortController()
    const signal = abortController.signal

    async function load() {
      setLoading(true)
      setError(null)
      setData(null)

      try {
        const res = await getApiTickersTickerIdSentiment(
          ticker!,
          { includeInsights: true },
          {
            signal,
          }
        )
        if (signal.aborted) return

        assertStreamOk(res, `Could not load sentiment for ${ticker}`)

        const streamRes = res as { stream: Response }
        await readStream(streamRes.stream, (parsedObj) => {
          if ("error" in parsedObj) {
            const msg = (parsedObj as { error: string }).error
            setError(msg)
            toastApiError(
              `Could not load sentiment for ${ticker}`,
              new Error(msg)
            )
            return
          }
          setData(parsedObj as TickerResult)
        })
      } catch (e: unknown) {
        if (signal.aborted) return
        const msg = e instanceof Error ? e.message : "Unknown error"
        setError(msg)
        toastApiError(`Could not load sentiment for ${ticker}`, e)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => abortController.abort()
  }, [ticker])

  return { data, loading, error }
}
