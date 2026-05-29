import { Link } from "react-router-dom"
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { AddToListButton } from "./AddToListButton"
import { cn } from "@/lib/utils"
import { parseSentimentLabel, parseHeadline } from "@/lib/sentiment"
import type { TickerResultSourcesItem as SourceResult } from "@/api/generated/dtos/tickerResultSourcesItem.gen"
import type { TickerResult } from "@/api/generated/dtos/tickerResult.gen"

export interface ResultCardProps {
  ticker: string
  avgScore: number
  articleCount: number
  sources?: SourceResult[]
  investmentInsight?: TickerResult["investmentInsight"]
}

export function ResultCard({
  ticker,
  avgScore,
  articleCount,
  sources = [],
  investmentInsight,
}: ResultCardProps) {
  const sentiment = parseSentimentLabel(avgScore)

  const sortedSources = [...sources].sort(
    (a, b) => b.updatedAtSec - a.updatedAtSec
  )
  const positive = sortedSources.filter((s) => s.score > 0)
  const negative = sortedSources.filter((s) => s.score < 0)

  let displayedSources: SourceResult[]
  if (avgScore > 0.2) {
    displayedSources = [...positive.slice(0, 2), ...negative.slice(0, 1)]
  } else if (avgScore < -0.2) {
    displayedSources = [...negative.slice(0, 2), ...positive.slice(0, 1)]
  } else {
    displayedSources = sortedSources.slice(0, 3)
  }

  return (
    <Link
      to={`/stock/${ticker}`}
      state={{
        tickerResult: {
          stock: { ticker, name: "" },
          sources,
          avgScore,
          investmentInsight,
        } as TickerResult,
      }}
      className="block w-full max-w-sm"
    >
      <Card className="group h-full cursor-pointer transition-colors hover:border-primary">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <h3 className="text-2xl leading-none font-semibold tracking-tight">
            {ticker}
          </h3>
          <div className="flex items-center gap-2">
            <AddToListButton ticker={ticker} />
            <Badge
              variant="outline"
              className={cn("text-xs font-semibold", sentiment.className)}
            >
              {sentiment.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pb-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="mb-1 block text-muted-foreground">
                Avg Score
              </span>
              <span className="text-lg font-medium">
                {avgScore !== null ? avgScore.toFixed(2) : "---"}
              </span>
            </div>
            <div>
              <span className="mb-1 block text-muted-foreground">Articles</span>
              <span className="text-lg font-medium">{articleCount}</span>
            </div>
          </div>
        </CardContent>

        {investmentInsight && (
          <CardContent className="pt-0 pb-2">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Insight
                </span>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {investmentInsight.confidence}
                </Badge>
              </div>
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {investmentInsight.summary}
              </p>
            </div>
          </CardContent>
        )}

        {displayedSources.length > 0 && (
          <CardFooter className="flex flex-col items-start gap-2 pt-0">
            <Separator className="mb-2" />
            <span className="text-xs font-semibold text-muted-foreground">
              Related News
            </span>
            {displayedSources.map((source, i) => {
              const { headline, body } = parseHeadline(source.snippet || "")
              const articleSentiment = parseSentimentLabel(source.score)
              return (
                <div key={i} className="flex w-full flex-col gap-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex-1 truncate text-xs font-medium">
                      {headline || source.url}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px]",
                        articleSentiment.className
                      )}
                    >
                      {source.score.toFixed(2)}
                    </Badge>
                  </div>
                  {body && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {body}
                    </p>
                  )}
                </div>
              )
            })}
          </CardFooter>
        )}
      </Card>
    </Link>
  )
}
