import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceDot,
} from "recharts"
import type { MouseHandlerDataParam } from "recharts"
import type { Candle } from "@/api/generated/dtos/candle.gen"
import type { CandleInterval } from "@/lib/intervals"
import type { PriceEvent } from "@/lib/events"
import { parseSentimentLabel } from "@/lib/sentiment"
import { format } from "date-fns"

interface Props {
  candles: Candle[]
  interval: CandleInterval | null
  mode: "latest" | "events"
  events?: PriceEvent[]
  eventInfoByTSec?: Map<number, { avgScore: number }>
  selectedEventTSec: number | null
  hoveredEventTSec: number | null
  onSelectEvent: (tSec: number | null) => void
  onHoverEvent: (tSec: number | null) => void
}

const SELECTED_COLOR = "var(--chart-1)"
const HOVERED_COLOR = "var(--chart-2)"
const DEFAULT_PIN_COLOR = "var(--muted-foreground)"

const TICK_FORMAT: Record<string, string> = {
  "5m": "HH:mm",
  "30m": "HH:mm",
  "1d": "MMM d",
}

const TOOLTIP_FORMAT: Record<string, string> = {
  "5m": "HH:mm",
  "30m": "EEE HH:mm",
  "1d": "MMM d, yyyy",
}

function formatTick(tSec: number, interval: CandleInterval | null): string {
  return format(new Date(tSec * 1000), TICK_FORMAT[interval ?? "5m"] ?? "HH:mm")
}

function formatTooltipLabel(
  tSec: number,
  interval: CandleInterval | null
): string {
  return format(
    new Date(tSec * 1000),
    TOOLTIP_FORMAT[interval ?? "5m"] ?? "HH:mm"
  )
}

export function StockTimeline({
  candles,
  interval,
  mode,
  events = [],
  eventInfoByTSec,
  selectedEventTSec,
  hoveredEventTSec,
  onSelectEvent,
  onHoverEvent,
}: Props) {
  if (candles.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border text-sm text-muted-foreground">
        Chart unavailable
      </div>
    )
  }

  const eventTSecSet = new Set(events.map((e) => e.tSec))
  const tickInterval = Math.max(1, Math.floor(candles.length / 8))

  const domainPad = (() => {
    const prices = candles.map((c) => c.close)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const pad = (max - min) * 0.05
    return [min - pad, max + pad] as [number, number]
  })()

  const hasSelection = selectedEventTSec !== null
  const lineOpacity = mode === "events" && hasSelection ? 0.4 : 1
  const closePriceByTSec = new Map(candles.map((c) => [c.tSec, c.close]))
  const activeTSec = selectedEventTSec ?? hoveredEventTSec

  // Hover: activate event when cursor x-column matches any event pin, regardless of y.
  // activeLabel is the raw XAxis dataKey value (tSec) at the cursor column.
  const handleMouseMove = (state: MouseHandlerDataParam) => {
    if (mode !== "events") return
    const tSec = Number(state.activeLabel)
    onHoverEvent(!isNaN(tSec) && eventTSecSet.has(tSec) ? tSec : null)
  }

  const handleMouseLeave = () => onHoverEvent(null)

  // Click: lock event at current x-column, or unlock if column has no event.
  const handleClick = (state: MouseHandlerDataParam) => {
    if (mode !== "events") return
    const tSec = Number(state.activeLabel)
    if (!isNaN(tSec) && eventTSecSet.has(tSec)) {
      onSelectEvent(tSec)
    } else {
      onSelectEvent(null)
    }
  }

  return (
    <div className="relative w-full">
      {/* Floating event sentiment tooltip */}
      {mode === "events" && activeTSec != null && (
        <div className="absolute top-2 right-2 z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
          <p className="font-semibold text-foreground">
            {formatTooltipLabel(activeTSec, interval)}
          </p>
          {(() => {
            const info = eventInfoByTSec?.get(activeTSec)
            if (!info) return null
            const s = parseSentimentLabel(info.avgScore)
            return (
              <p className={s.className}>
                {s.label} · {info.avgScore.toFixed(2)}
              </p>
            )
          })()}
          {selectedEventTSec != null && (
            <p className="mt-1 text-muted-foreground">
              Click elsewhere to unlock
            </p>
          )}
        </div>
      )}

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            accessibilityLayer
            data={candles}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            style={{ cursor: mode === "events" ? "pointer" : "default" }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="tSec"
              tickFormatter={(v: number) => formatTick(v, interval)}
              interval={tickInterval}
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
            />
            <YAxis
              domain={domainPad}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={50}
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
            />
            <Tooltip
              labelFormatter={(v) => formatTooltipLabel(v as number, interval)}
              formatter={(v) => [(v as number).toFixed(2), "Close"]}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke="var(--chart-1)"
              strokeWidth={1.5}
              strokeOpacity={lineOpacity}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 4 }}
            />
            {mode === "events" &&
              events.map((event) => {
                const price = closePriceByTSec.get(event.tSec)
                if (price == null) return null
                const isSelected = event.tSec === selectedEventTSec
                const isHovered = event.tSec === hoveredEventTSec
                const fill = isSelected
                  ? SELECTED_COLOR
                  : isHovered
                    ? HOVERED_COLOR
                    : DEFAULT_PIN_COLOR
                return (
                  <ReferenceDot
                    key={event.id}
                    x={event.tSec}
                    y={price}
                    r={isSelected || isHovered ? 7 : 5}
                    fill={fill}
                    stroke="var(--background)"
                    strokeWidth={1.5}
                  />
                )
              })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {interval && (
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {interval} candles
        </p>
      )}
    </div>
  )
}
