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

const MAX_EVENTS_BY_RANGE: Record<RangePresetKey, number> = {
  "1D": 2,
  "1W": 3,
  "1M": 5,
  "1Y": 7,
}
import { detectEvents } from "@/lib/events"
import type { Stock } from "@/models/Stock"
import { useCandles } from "@/hooks/useCandles"
import {
  useTickerLatestPipeline,
  useTickerEventPipeline,
} from "@/hooks/useTickerPipeline"

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

  // Router state now carries only { stock } — no articles or scores
  const preloadedStock =
    (location.state as { stock?: Stock } | null)?.stock ?? null

  const [range, setRange] = useState<RangeKey>("latest")
  const [selectedEventTSec, setSelectedEventTSec] = useState<number | null>(
    null
  )
  const [hoveredEventTSec, setHoveredEventTSec] = useState<number | null>(null)

  // Stage 1 (latest): articles + sentiment for the "latest" tab
  const { articles: latestArticles, avgScore: latestAvgScore } =
    useTickerLatestPipeline(ticker)

  const duration: CandleDuration = range === "latest" ? "today" : range
  const interval = pickIntervalForDuration(duration)

  const { candles, loading: candlesLoading } = useCandles(
    ticker,
    duration,
    interval
  )

  const events = useMemo(() => {
    if (range === "latest" || candles.length === 0) return []
    const maxEvents = MAX_EVENTS_BY_RANGE[range as RangePresetKey]
    return detectEvents(candles, [], { maxEvents })
  }, [range, candles])

  const intervalSec = interval != null ? intervalToSec(interval) : undefined

  // Stage 1 (event mode): articles + sentiment per event
  const {
    eventPipelineMap,
    allArticles: eventAllArticles,
    loading: eventLoading,
  } = useTickerEventPipeline(
    range !== "latest" ? ticker : undefined,
    events,
    intervalSec
  )

  // Per-event avg scores for the timeline tooltip
  const eventInfoByTSec = useMemo(() => {
    const map = new Map<number, { avgScore: number }>()
    for (const [tSec, entry] of eventPipelineMap) {
      if (entry.avgScore != null) map.set(tSec, { avgScore: entry.avgScore })
    }
    return map
  }, [eventPipelineMap])

  const articles =
    range === "latest" ? (latestArticles ?? []) : eventAllArticles

  // avgScore in header is always from latest mode
  const avgScore = latestAvgScore

  const activeEventTSec = selectedEventTSec ?? hoveredEventTSec

  const highlightedUrls = useMemo((): Set<string> | undefined => {
    if (!activeEventTSec) return undefined
    const entry = eventPipelineMap.get(activeEventTSec)
    return entry && entry.articles.length > 0
      ? new Set<string>(entry.articles.map((a) => a.url))
      : undefined
  }, [activeEventTSec, eventPipelineMap])

  const isInitialLoading =
    range === "latest"
      ? latestArticles === undefined
      : eventAllArticles.length === 0 && eventLoading

  const stockName = preloadedStock?.name || ticker || ""

  if (!ticker) {
    return <div className="p-8">Ticker not found.</div>
  }

  const overall = parseSentimentLabel(avgScore ?? 0)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">{stockName || ticker}</h1>
          <p className="mt-1 text-xl text-muted-foreground">{ticker}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {avgScore != null ? (
            <Badge
              variant="outline"
              className={cn("px-4 py-2 text-base font-bold", overall.className)}
            >
              {overall.label} · {avgScore.toFixed(2)}
            </Badge>
          ) : (
            <Skeleton className="h-10 w-36 rounded-full" />
          )}
          <AddToListButton ticker={ticker} />
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
            {isInitialLoading ? (
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
          <CompetitorsAccordion ticker={ticker} />
        </div>
      </div>
    </div>
  )
}
