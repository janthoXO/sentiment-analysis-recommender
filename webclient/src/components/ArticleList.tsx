import { useMemo } from "react"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { parseSentimentLabel, parseHeadline } from "@/lib/sentiment"
import type { TickerArticlesSourcesItem } from "@/api/generated/dtos/tickerArticlesSourcesItem.gen"

interface Props {
  articles: TickerArticlesSourcesItem[]
  scoresByUrl: Map<string, number>
  highlightedUrls?: Set<string>
}

function ArticleCard({
  article,
  score,
  dimmed,
}: {
  article: TickerArticlesSourcesItem
  score: number | undefined
  dimmed: boolean
}) {
  const { headline, body } = parseHeadline(article.snippet ?? "")
  const articleSentiment = score != null ? parseSentimentLabel(score) : null

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4",
        dimmed ? "border-border/40 bg-muted/40" : "bg-card"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p
            className={cn(
              "text-base leading-snug font-semibold",
              dimmed && "text-muted-foreground"
            )}
          >
            {headline || article.url}
          </p>
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-1 truncate text-sm hover:underline",
              dimmed ? "text-muted-foreground/60" : "text-muted-foreground"
            )}
          >
            {article.url} <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        {articleSentiment ? (
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 font-bold",
              dimmed ? "opacity-40" : articleSentiment.className
            )}
          >
            {score!.toFixed(2)}
          </Badge>
        ) : (
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        )}
      </div>
      {body && (
        <p
          className={cn(
            "text-sm",
            dimmed ? "text-muted-foreground/60" : "text-muted-foreground"
          )}
        >
          {body}
        </p>
      )}
    </div>
  )
}

export function ArticleList({ articles, scoresByUrl, highlightedUrls }: Props) {
  const { highlighted, rest } = useMemo(() => {
    if (!highlightedUrls || highlightedUrls.size === 0) {
      return { highlighted: null, rest: articles }
    }

    return {
      highlighted: articles.filter((a) => highlightedUrls.has(a.url)),
      rest: articles.filter((a) => !highlightedUrls.has(a.url)),
    }
  }, [articles, highlightedUrls])

  if (highlighted === null) {
    return (
      <div className="flex flex-col gap-4">
        {rest.map((article, i) => (
          <ArticleCard
            key={i}
            article={article}
            score={scoresByUrl.get(article.url)}
            dimmed={false}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {highlighted.map((article, i) => (
        <ArticleCard
          key={i}
          article={article}
          score={scoresByUrl.get(article.url)}
          dimmed={false}
        />
      ))}

      {rest.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground">
              {rest.length} other article{rest.length !== 1 ? "s" : ""}
            </span>
            <Separator className="flex-1" />
          </div>
          {rest.map((article, i) => (
            <ArticleCard
              key={i}
              article={article}
              score={scoresByUrl.get(article.url)}
              dimmed={true}
            />
          ))}
        </>
      )}
    </div>
  )
}
