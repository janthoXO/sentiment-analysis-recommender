import { useState, useEffect, useMemo } from "react"
import { toast } from "sonner"
import { readStream } from "@/lib/stream"
import { getApiTickersTickerIdSentiment } from "@/api/generated/sentimentSearchAPI.gen"
import type { PriceEvent } from "@/lib/events"
import type {
  TickerResult,
  TickerResultSourcesItem,
} from "@/api/generated/dtos"

export function useSentimentByEvents(
  ticker: string | undefined,
  events: PriceEvent[],
  intervalSec: number | undefined
): {
  eventSourceMap: Map<number, TickerResult>
  allSources: TickerResultSourcesItem[]
  avgScore: number | undefined
  loading: boolean
  error: string | null
} {
  const [eventSourceMap, setEventSourceMap] = useState<
    Map<number, TickerResult>
  >(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eventTSecs = useMemo(() => events.map((e) => e.tSec), [events])

  useEffect(() => {
    const abortController = new AbortController()
    const signal = abortController.signal

    async function load() {
      if (!ticker || eventTSecs.length === 0 || intervalSec == null) {
        setLoading(false)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const res = await getApiTickersTickerIdSentiment(
          ticker!,
          { eventTSec: eventTSecs, intervalSec },
          { signal }
        )
        if (signal.aborted) return

        if (res.status !== 200) {
          throw new Error(`Sentiment request failed: ${res.status}`)
        }

        await readStream(res.stream, (parsedObj) => {
          if ("error" in parsedObj) return
          const result = parsedObj as TickerResult
          if (result.eventTSec !== undefined) {
            setEventSourceMap((prev) => {
              const newMap = new Map(prev)
              newMap.set(result.eventTSec!, result)
              return newMap
            })
          }
        })
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return
        if (signal.aborted) return
        const msg =
          e instanceof Error ? e.message : "Failed to load event sentiment"
        setError(msg)
        toast.error("Could not load event sentiment", { description: msg })
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => abortController.abort()
  }, [ticker, eventTSecs, intervalSec])

  const allSources = useMemo(() => {
    const seen = new Set<string>()
    const result: TickerResultSourcesItem[] = []
    for (const r of eventSourceMap.values()) {
      for (const s of r.sources) {
        if (!seen.has(s.url)) {
          seen.add(s.url)
          result.push(s)
        }
      }
    }
    return result
  }, [eventSourceMap])

  const avgScore = useMemo(() => {
    const all = Array.from(eventSourceMap.values())
    if (all.length === 0) return undefined
    return all.reduce((sum, r) => sum + r.avgScore, 0) / all.length
  }, [eventSourceMap])

  return { eventSourceMap, allSources, avgScore, loading, error }
}
