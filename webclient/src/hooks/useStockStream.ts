import { getApiTickersSentiment } from "@/api/generated/sentimentSearchAPI.gen"
import { useState, useCallback, useRef } from "react"
import { readStream } from "@/lib/stream"
import type { TickerResult } from "@/api/generated/dtos"
import { assertStreamOk, toastApiError } from "@/lib/api-error"

type StreamArgs = { q: string } | { tickerIds: string[] }

export function useStockStream() {
  const [results, setResults] = useState<TickerResult[]>([])
  const [errorsByTicker, setErrorsByTicker] = useState<Record<string, string>>(
    {}
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const search = useCallback(async (args: StreamArgs) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setLoading(true)
    setError(null)
    setResults([])
    setErrorsByTicker({})

    try {
      const response = await getApiTickersSentiment(
        { ...args, includeInsights: true },
        {
          signal: abortController.signal,
        }
      )

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

  return { results, errorsByTicker, loading, error, search }
}
