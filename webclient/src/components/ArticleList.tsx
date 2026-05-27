import { useMemo } from "react"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { parseSentimentLabel, parseHeadline } from "@/lib/sentiment"
import type { TickerResultSourcesItem as SourceResult } from "@/api/generated/dtos/tickerResultSourcesItem.gen"

interface Props {
  articles: SourceResult[]
  highlightedUrls?: Set<string>
}

function ArticleCard({
  source,
  dimmed,
}: {
  source: SourceResult
  dimmed: boolean
}) {
  const { headline, body } = parseHeadline(source.snippet ?? "")
  const articleSentiment = parseSentimentLabel(source.score)

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
            {headline || source.url}
          </p>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-1 truncate text-sm hover:underline",
              dimmed ? "text-muted-foreground/60" : "text-muted-foreground"
            )}
          >
            {source.url} <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 font-bold",
            dimmed ? "opacity-40" : articleSentiment.className
          )}
        >
          {source.score.toFixed(2)}
        </Badge>
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

export function ArticleList({ articles, highlightedUrls }: Props) {
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
        {rest.map((source, i) => (
          <ArticleCard key={i} source={source} dimmed={false} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {highlighted.map((source, i) => (
        <ArticleCard key={i} source={source} dimmed={false} />
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
          {rest.map((source, i) => (
            <ArticleCard key={i} source={source} dimmed={true} />
          ))}
        </>
      )}
    </div>
  )
}
