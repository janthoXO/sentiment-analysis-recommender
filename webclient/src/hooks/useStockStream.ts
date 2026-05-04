import { getApiSearch } from "@/api/sentimentSearchAPI.gen"
import { useState, useCallback } from "react"
import { toast } from "sonner"

export interface StockResult {
  ticker: string
  avgScore: number | null
  articleCount: number
}

export function useStockStream() {
  const [results, setResults] = useState<StockResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(async (ticker: string) => {
    setLoading(true)
    setError(null)
    setResults([]) // Clear previous results

    try {
      const response = await getApiSearch({ query: ticker })

      if (response.status !== 200) {
        throw new Error("Failed to fetch")
      }

      if (!response.stream.body) {
        throw new Error("No stream in response")
      }

      const reader = response.stream.body.getReader()
      const decoder = new TextDecoder("utf-8")
      let buffer = ""

      let done = false
      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone

        if (value) {
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\\n")

          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line)
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
                setResults((prev) => {
                  // if ticker already exists, update it, else append
                  const index = prev.findIndex(
                    (p) => p.ticker === parsed.ticker
                  )
                  if (index >= 0) {
                    const newRes = [...prev]
                    newRes[index] = parsed
                    return newRes
                  }
                  return [...prev, parsed]
                })
              } catch (e: unknown) {
                if (
                  e instanceof Error &&
                  e.message !== "Unexpected end of JSON input" &&
                  !e.message.includes("Unexpected token")
                ) {
                  throw e
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Stream error:", e)
      const msg = e instanceof Error ? e.message : "Unknown error occurred"
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  return { results, loading, error, search }
}
