import { useParams, useLocation } from "react-router-dom"
import { useState, useEffect } from "react"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { AddToListButton } from "@/components/AddToListButton"
import { cn } from "@/lib/utils"
import type { TickerResult } from "@/api/generated/dtos/tickerResult.gen"
import { useStockStream } from "@/hooks/useStockStream"

function parseSentimentLabel(score: number): {
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

function parseHeadline(snippet: string): { headline: string; body: string } {
  const idx = snippet.indexOf("\n")
  if (idx === -1) return { headline: snippet, body: "" }
  return {
    headline: snippet.slice(0, idx).trim(),
    body: snippet.slice(idx + 1).trim(),
  }
}

export default function StockDetailPage() {
  const { ticker } = useParams()
  const location = useLocation()

  const [data, setData] = useState<TickerResult | null>(
    location.state?.tickerResult || null
  )
  const { results, loading, search } = useStockStream()

  useEffect(() => {
    if (!data && ticker) {
      void search(ticker)
    }
  }, [data, ticker, search])

  useEffect(() => {
    if (!data && ticker && results.length > 0) {
      const found = results.find((r) => r.stock.ticker === ticker)
      if (found) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setData(found)
      }
    }
  }, [results, data, ticker])

  if (loading && !data) return <div className="p-8">Loading data...</div>
  if (!data) return <div className="p-8">No data found for {ticker}</div>

  const overall = parseSentimentLabel(data.avgScore)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
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
            {overall.label} · {data.avgScore.toFixed(2)}
          </Badge>
          <AddToListButton ticker={ticker!} />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">
          News &amp; Articles{" "}
          <span className="text-base font-normal text-muted-foreground">
            ({data.sources.length})
          </span>
        </h2>
        <div className="flex flex-col gap-4">
          {data.sources.map((source, i) => {
            const { headline, body } = parseHeadline(source.snippet || "")
            const articleSentiment = parseSentimentLabel(source.score)
            return (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-xl border p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-base leading-snug font-semibold">
                      {headline || source.url}
                    </p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 truncate text-sm text-muted-foreground hover:underline"
                    >
                      {source.url} <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 font-bold",
                      articleSentiment.className
                    )}
                  >
                    {source.score.toFixed(2)}
                  </Badge>
                </div>
                {body && (
                  <p className="text-sm text-muted-foreground">{body}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
