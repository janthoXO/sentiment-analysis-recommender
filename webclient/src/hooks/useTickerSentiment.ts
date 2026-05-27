import { useState, useEffect } from "react"
import { toast } from "sonner"
import { readStream } from "@/lib/stream"
import { getApiTickersTickerIdSentiment } from "@/api/generated/sentimentSearchAPI.gen"
import type { TickerResult } from "@/api/generated/dtos"

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
        const res = await getApiTickersTickerIdSentiment(ticker!, undefined, {
          signal,
        })
        if (signal.aborted) return

        if (res.status !== 200) {
          throw new Error(`Sentiment request failed: ${res.status}`)
        }

        await readStream(res.stream, (parsedObj) => {
          if ("error" in parsedObj) {
            throw new Error(String((parsedObj as { error: string }).error))
          }
          setData(parsedObj as TickerResult)
        })
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return
        if (signal.aborted) return
        const msg = e instanceof Error ? e.message : "Unknown error"
        setError(msg)
        toast.error(`Could not load sentiment for ${ticker}`, {
          description: msg,
        })
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => abortController.abort()
  }, [ticker])

  return { data, loading, error }
}
