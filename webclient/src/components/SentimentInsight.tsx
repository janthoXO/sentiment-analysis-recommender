import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TickerResult } from "@/api/generated/dtos/tickerResult.gen"

interface Props {
  insight: NonNullable<TickerResult["investmentInsight"]>
}

const verdictClassName: Record<Props["insight"]["verdict"], string> = {
  bullish: "border-green-400 bg-green-50 text-green-700",
  bearish: "border-red-400 bg-red-50 text-red-700",
  neutral: "border-gray-200 bg-gray-50 text-gray-700",
  mixed: "border-amber-300 bg-amber-50 text-amber-700",
}

export function SentimentInsight({ insight }: Props) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Sentiment Insight</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn("capitalize", verdictClassName[insight.verdict])}
          >
            {insight.verdict}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {insight.confidence} confidence
          </Badge>
        </div>
      </div>

      <p className="text-sm leading-6 text-muted-foreground">
        {insight.summary}
      </p>

      {insight.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {insight.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted-foreground/80">
        {insight.disclaimer}
      </p>
    </section>
  )
}
