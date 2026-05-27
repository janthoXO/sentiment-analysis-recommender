export type CandleInterval = "5m" | "30m" | "1d"

export const RANGE_PRESETS = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "1Y": 365 * 86_400,
} as const

export type RangePresetKey = keyof typeof RANGE_PRESETS

export type CandleDuration = RangePresetKey | "today"

export function pickIntervalForDuration(
  duration: CandleDuration
): CandleInterval {
  if (duration === "today" || duration === "1D") return "5m"
  if (duration === "1W") return "30m"
  return "1d"
}

export function intervalToSec(interval: CandleInterval): number {
  if (interval === "5m") return 300
  if (interval === "30m") return 1_800
  return 86_400
}
