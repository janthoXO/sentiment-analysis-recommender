import { Link } from "react-router-dom"
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { AddToListButton } from "./AddToListButton"
import { cn } from "@/lib/utils"
import { parseSentimentLabel, parseHeadline } from "@/lib/sentiment"
import type { Stock } from "@/models/Stock"
import type { Article } from "@/models/Article"

export interface ResultCardProps {
  stock: Stock
}

export function ResultCard({ stock }: ResultCardProps) {
  const { ticker, name, articles, avgScore, sector, industry, exchange } = stock
  const sentiment = avgScore != null ? parseSentimentLabel(avgScore) : null
  const metadataBadges = Array.from(
    new Set(
      [sector, industry, exchange].filter((value): value is string =>
        Boolean(value)
      )
    )
  )

  // Sort articles by recency; apply positive/negative weighting once we have avgScore
  const sortedArticles = articles
    ? [...articles].sort((a, b) => b.updatedAtSec - a.updatedAtSec)
    : []

  let displayedArticles: Article[]
  if (avgScore != null && avgScore > 0.2) {
    const pos = sortedArticles.filter((a) => (a.score ?? 0) > 0)
    const neg = sortedArticles.filter((a) => (a.score ?? 0) < 0)
    displayedArticles = [...pos.slice(0, 2), ...neg.slice(0, 1)]
  } else if (avgScore != null && avgScore < -0.2) {
    const pos = sortedArticles.filter((a) => (a.score ?? 0) > 0)
    const neg = sortedArticles.filter((a) => (a.score ?? 0) < 0)
    displayedArticles = [...neg.slice(0, 2), ...pos.slice(0, 1)]
  } else {
    displayedArticles = sortedArticles.slice(0, 3)
  }

  return (
    <Link
      to={`/stock/${ticker}`}
      state={{ stock }}
      className="block w-full max-w-sm"
    >
      <Card className="group h-full cursor-pointer transition-colors hover:border-primary">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <h3 className="text-2xl leading-none font-semibold tracking-tight">
              {ticker}
            </h3>
            {name && name !== ticker && (
              <p className="mt-0.5 max-w-[160px] truncate text-xs text-muted-foreground">
                {name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <AddToListButton ticker={ticker} />
            {sentiment ? (
              <Badge
                variant="outline"
                className={cn("text-xs font-semibold", sentiment.className)}
              >
                {sentiment.label}
              </Badge>
            ) : (
              <Skeleton className="h-5 w-16 rounded-full" />
            )}
          </div>
        </CardHeader>

        <CardContent className="pb-2">
          {metadataBadges.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {metadataBadges.map((label) => (
                <Badge
                  key={label}
                  variant="secondary"
                  className="max-w-full truncate text-[10px] font-medium"
                >
                  {label}
                </Badge>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="mb-1 block text-muted-foreground">
                Avg Score
              </span>
              <span className="text-lg font-medium">
                {avgScore != null ? avgScore.toFixed(2) : "---"}
              </span>
            </div>
            <div>
              <span className="mb-1 block text-muted-foreground">Articles</span>
              <span className="text-lg font-medium">
                {articles != null ? articles.length : "---"}
              </span>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-2 pt-0">
          <Separator className="mb-2" />
          <span className="text-xs font-semibold text-muted-foreground">
            Related News
          </span>

          {articles === undefined ? (
            // Articles still loading
            <div className="flex w-full flex-col gap-1.5">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-4/5 rounded" />
            </div>
          ) : displayedArticles.length === 0 ? (
            <p className="text-xs text-muted-foreground">No articles found.</p>
          ) : (
            displayedArticles.map((article) => {
              const score = article.score
              const { headline, body } = parseHeadline(article.snippet || "")
              const articleSentiment =
                score != null ? parseSentimentLabel(score) : null

              return (
                <div key={article.url} className="flex w-full flex-col gap-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex-1 truncate text-xs font-medium">
                      {headline || article.url}
                    </span>
                    {articleSentiment ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px]",
                          articleSentiment.className
                        )}
                      >
                        {score!.toFixed(2)}
                      </Badge>
                    ) : (
                      <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
                    )}
                  </div>
                  {body && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {body}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </CardFooter>
      </Card>
    </Link>
  )
}
