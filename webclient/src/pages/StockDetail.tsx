import { useParams, useLocation } from "react-router-dom"
import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AddToListButton } from "@/components/AddToListButton"
import { StockTimeline } from "@/components/StockTimeline"
import { ArticleList } from "@/components/ArticleList"
import { CompetitorsAccordion } from "@/components/CompetitorsAccordion"
import { cn } from "@/lib/utils"
import { parseSentimentLabel } from "@/lib/sentiment"
import {
  pickIntervalForDuration,
  intervalToSec,
  type CandleDuration,
  type RangePresetKey,
} from "@/lib/intervals"
import { detectEvents } from "@/lib/events"
import type { TickerResult } from "@/api/generated/dtos/tickerResult.gen"
import { useTickerSentiment } from "@/hooks/useTickerSentiment"
import { useCandles } from "@/hooks/useCandles"
import { useSentimentByEvents } from "@/hooks/useSentimentByEvents"

type RangeKey = "latest" | RangePresetKey

const RANGES: { label: string; value: RangeKey }[] = [
  { label: "Latest", value: "latest" },
  { label: "1D", value: "1D" },
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
  { label: "1Y", value: "1Y" },
]

export default function StockDetailPage() {
  const { ticker } = useParams()
  const location = useLocation()

  const preloaded =
    (location.state as { tickerResult?: TickerResult } | null)?.tickerResult ??
    null

  const [range, setRange] = useState<RangeKey>("latest")
  const [selectedEventTSec, setSelectedEventTSec] = useState<number | null>(
    null
  )
  const [hoveredEventTSec, setHoveredEventTSec] = useState<number | null>(null)
  // Fetch per-ticker sentiment only when not preloaded from router state
  const { data: fetched, loading: fetchLoading } = useTickerSentiment(
    preloaded ? undefined : ticker
  )

  const data: TickerResult | null = preloaded ?? fetched

  const duration: CandleDuration = range === "latest" ? "today" : range
  const interval = pickIntervalForDuration(duration)

  const { candles, loading: candlesLoading } = useCandles(
    ticker,
    duration,
    interval
  )

  // Client-side event detection — only for non-latest modes.
  const events = useMemo(() => {
    if (range === "latest" || candles.length === 0) return []
    return detectEvents(candles, [])
  }, [range, candles])

  const intervalSec = interval != null ? intervalToSec(interval) : undefined

  const {
    eventSourceMap,
    allSources,
    loading: eventSentimentLoading,
  } = useSentimentByEvents(
    range !== "latest" ? ticker : undefined,
    events,
    intervalSec
  )

  // Per-event sentiment info for the timeline tooltip
  const eventInfoByTSec = useMemo(() => {
    const map = new Map<number, { avgScore: number }>()
    for (const [tSec, result] of eventSourceMap) {
      map.set(tSec, { avgScore: result.avgScore })
    }
    return map
  }, [eventSourceMap])

  const articles = range === "latest" ? (data?.sources ?? []) : allSources

  // Header avgScore always anchored to the latest sentiment
  const avgScore = data?.avgScore

  const activeEventTSec = selectedEventTSec ?? hoveredEventTSec

  const highlightedUrls = useMemo((): Set<string> | undefined => {
    if (!activeEventTSec) return undefined
    const result = eventSourceMap.get(activeEventTSec)
    return result && result.sources.length > 0
      ? new Set<string>(result.sources.map((s) => s.url))
      : undefined
  }, [activeEventTSec, eventSourceMap])

  const isLoading = fetchLoading && !data
  const isSentimentLoading =
    range !== "latest" && (candlesLoading || eventSentimentLoading)

  if (isLoading) {
    return <div className="p-8">Loading data...</div>
  }
  if (!data) {
    return <div className="p-8">No data found for {ticker}</div>
  }

  const overall = parseSentimentLabel(avgScore ?? data.avgScore)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">{data.stock.name || ticker}</h1>
          <p className="mt-1 text-xl text-muted-foreground">{ticker}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <Badge
            variant="outline"
            className={cn("px-4 py-2 text-base font-bold", overall.className)}
          >
            {overall.label} · {(avgScore ?? data.avgScore).toFixed(2)}
          </Badge>
          <AddToListButton ticker={ticker!} />
        </div>
      </div>

      <Separator />

      {/* Two-column layout: main + competitors */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column: timeline + articles */}
        <div className="flex flex-col gap-4">
          {/* Range selector */}
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => {
              if (v) {
                setRange(v as RangeKey)
                setSelectedEventTSec(null)
                setHoveredEventTSec(null)
              }
            }}
            className="self-start"
          >
            {RANGES.map(({ label, value }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="px-4 text-sm"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* Price chart */}
          {candlesLoading ? (
            <Skeleton className="h-56 w-full rounded-xl" />
          ) : (
            <div>
              <StockTimeline
                candles={candles}
                interval={interval ?? null}
                mode={range === "latest" ? "latest" : "events"}
                events={events}
                eventInfoByTSec={eventInfoByTSec}
                selectedEventTSec={selectedEventTSec}
                hoveredEventTSec={hoveredEventTSec}
                onSelectEvent={setSelectedEventTSec}
                onHoverEvent={setHoveredEventTSec}
              />
            </div>
          )}

          <Separator />

          {/* Article list */}
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold">
              News &amp; Articles{" "}
              <span className="text-base font-normal text-muted-foreground">
                {highlightedUrls
                  ? `(${highlightedUrls.size} of ${articles.length})`
                  : `(${articles.length})`}
              </span>
            </h2>
            {range !== "latest" && (
              <p className="text-sm text-muted-foreground">
                Hover an event pin to preview its articles. Click to lock the
                selection; click elsewhere to clear it.
              </p>
            )}
            {isSentimentLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            ) : (
              <ArticleList
                articles={articles}
                highlightedUrls={highlightedUrls}
              />
            )}
          </div>
        </div>

        {/* Right column: competitors */}
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Competitors</h2>
          <CompetitorsAccordion ticker={ticker!} />
        </div>
      </div>
    </div>
  )
}
