export interface ResultCardProps {
  ticker: string
  avgScore: number
  articleCount: number
}

export function ResultCard({
  ticker,
  avgScore,
  articleCount,
}: ResultCardProps) {
  let sentimentColor = "border-gray-200 bg-gray-50 text-gray-700"
  let sentimentLabel = "Neutral"

  if (avgScore > 0.2) {
    sentimentColor = "border-green-400 bg-green-50 text-green-700"
    sentimentLabel = "Bullish"
  } else if (avgScore < -0.2) {
    sentimentColor = "border-red-400 bg-red-50 text-red-700"
    sentimentLabel = "Bearish"
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl leading-none font-semibold tracking-tight">
          {ticker}
        </h3>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${sentimentColor}`}
        >
          {sentimentLabel}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="mb-1 block text-muted-foreground">Avg Score</span>
          <span className="text-lg font-medium">
            {avgScore !== null ? avgScore.toFixed(2) : "---"}
          </span>
        </div>
        <div>
          <span className="mb-1 block text-muted-foreground">Articles</span>
          <span className="text-lg font-medium">{articleCount}</span>
        </div>
      </div>
    </div>
  )
}
