import { getApiSearch } from "@/api/generated/sentimentSearchAPI.gen"
import { useState, useCallback, useRef } from "react"
import { toast } from "sonner"
import { readStream } from "@/lib/stream"
import type { TickerResult } from "@/api/generated/dtos"

export function useStockStream() {
  const [results, setResults] = useState<TickerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const search = useCallback(async (query: string) => {
    // 1. Cleanup previous requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // 2. Reset State
    setLoading(true)
    setError(null)
    setResults([])

    try {
      // 3. Initiate the Fetch
      const response = await getApiSearch({ q: query })

      if (response.status !== 200) {
        throw new Error("Failed to fetch stream")
      }

      // 4. Consume the stream using the Orval utility
      await readStream(response.stream, (parsedObj) => {
        // Defensive check just in case the backend streams an error object
        if ("error" in parsedObj && parsedObj.error) {
          throw new Error(String(parsedObj.error))
        }

        if ("avgScore" in parsedObj) {
          setResults((prev) => {
            const index = prev.findIndex(
              (p) => p.stock?.ticker === parsedObj.stock?.ticker
            )
            if (index >= 0) {
              const newRes = [...prev]
              newRes[index] = parsedObj
              return newRes
            }
            return [...prev, parsedObj]
          })
        }
      })
    } catch (e: unknown) {
      // Silently ignore user-triggered aborts
      if (e instanceof Error && e.name === "AbortError") return

      console.error("Stream error:", e)
      const msg = e instanceof Error ? e.message : "Unknown error occurred"
      setError(msg)
      toast.error(msg)
    } finally {
      // Only disable loading if a new search hasn't already started
      if (abortControllerRef.current === abortController) {
        setLoading(false)
        abortControllerRef.current = null
      }
    }
  }, [])

  return { results, loading, error, search }
}
