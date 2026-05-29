import { getApiTickersSentiment } from "@/api/generated/sentimentSearchAPI.gen"
import { useState, useCallback, useEffect, useRef } from "react"
import { readStream } from "@/lib/stream"
import type { TickerResult } from "@/api/generated/dtos"
import { assertStreamOk, toastApiError } from "@/lib/api-error"
import { useLlmInsights } from "@/context/llm-insights-provider"

type StreamArgs = { q: string } | { tickerIds: string[] }

export function useStockStream() {
  const { enabled: insightsEnabled } = useLlmInsights()
  const [results, setResults] = useState<TickerResult[]>([])
  const [errorsByTicker, setErrorsByTicker] = useState<Record<string, string>>(
    {}
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const insightAbortControllerRef = useRef<AbortController | null>(null)
  const requestedInsightTickersRef = useRef<Set<string>>(new Set())

  const search = useCallback(async (args: StreamArgs) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    if (insightAbortControllerRef.current) {
      insightAbortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setLoading(true)
    setError(null)
    setResults([])
    setErrorsByTicker({})
    requestedInsightTickersRef.current = new Set()

    try {
      const response = await getApiTickersSentiment(args, {
        signal: abortController.signal,
      })

      assertStreamOk(response, "Search failed")

      const streamResponse = response as { stream: Response }
      await readStream(streamResponse.stream, (parsedObj) => {
        if ("error" in parsedObj) {
          const chunk = parsedObj as {
            error: string
            code?: string
            ticker?: string
          }
          if (chunk.ticker) {
            setErrorsByTicker((prev) => ({
              ...prev,
              [chunk.ticker!]: chunk.error,
            }))
          } else {
            setError(chunk.error)
            toastApiError("Search failed", new Error(chunk.error))
          }
          return
        }

        const result = parsedObj as TickerResult
        setResults((prev) => {
          const index = prev.findIndex(
            (p) => p.stock?.ticker === result.stock?.ticker
          )
          if (index >= 0) {
            const newRes = [...prev]
            newRes[index] = result
            return newRes
          }
          return [...prev, result]
        })
      })
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return

      console.error("Stream error:", e)
      const msg = e instanceof Error ? e.message : "Unknown error occurred"
      setError(msg)
      toastApiError("Search failed", e)
    } finally {
      if (abortControllerRef.current === abortController) {
        setLoading(false)
        abortControllerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!insightsEnabled) {
      requestedInsightTickersRef.current = new Set()
      insightAbortControllerRef.current?.abort()
      insightAbortControllerRef.current = null
      return
    }

    if (loading || results.length === 0) return

    const tickersToLoad = results
      .filter((result) => !result.investmentInsight)
      .map((result) => result.stock.ticker)
      .filter((ticker) => !requestedInsightTickersRef.current.has(ticker))

    if (tickersToLoad.length === 0) return

    for (const ticker of tickersToLoad) {
      requestedInsightTickersRef.current.add(ticker)
    }

    const abortController = new AbortController()
    insightAbortControllerRef.current?.abort()
    insightAbortControllerRef.current = abortController

    async function loadInsights() {
      try {
        const response = await getApiTickersSentiment(
          { tickerIds: tickersToLoad, includeInsights: true },
          { signal: abortController.signal }
        )

        assertStreamOk(response, "Could not load LLM insights")

        const streamResponse = response as { stream: Response }
        await readStream(streamResponse.stream, (parsedObj) => {
          if ("error" in parsedObj) return

          const result = parsedObj as TickerResult
          if (!result.investmentInsight) return

          setResults((prev) => {
            const index = prev.findIndex(
              (p) => p.stock?.ticker === result.stock?.ticker
            )
            if (index < 0) return prev

            const next = [...prev]
            next[index] = {
              ...prev[index]!,
              investmentInsight: result.investmentInsight,
            }
            return next
          })
        })
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return
        toastApiError("Could not load LLM insights", e)
      } finally {
        if (insightAbortControllerRef.current === abortController) {
          insightAbortControllerRef.current = null
        }
      }
    }

    void loadInsights()

    return () => {
      abortController.abort()
    }
  }, [insightsEnabled, loading, results])

  return { results, errorsByTicker, loading, error, search }
}
