export function parseSentimentLabel(score: number): {
  label: string
  className: string
} {
  if (score > 0.2)
    return {
      label: "Bullish",
      className: "border-green-400 bg-green-50 text-green-700",
    }
  if (score < -0.2)
    return {
      label: "Bearish",
      className: "border-red-400 bg-red-50 text-red-700",
    }
  return {
    label: "Neutral",
    className: "border-gray-200 bg-gray-50 text-gray-700",
  }
}

export function parseHeadline(snippet: string): {
  headline: string
  body: string
} {
  const idx = snippet.indexOf("\n")
  if (idx === -1) return { headline: snippet, body: "" }
  return {
    headline: snippet.slice(0, idx).trim(),
    body: snippet.slice(idx + 1).trim(),
  }
}
