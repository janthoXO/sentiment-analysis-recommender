import {
  getApiTickers,
  getApiTickersTrending,
  getApiTickersTickerIdArticles,
  getApiTickersTickerIdArticlesSentiment,
  getApiTickersTickerIdPeers,
} from "@/api/generated/sentimentSearchAPI.gen"
import type { Stock as ApiStock } from "@/api/generated/dtos/stock.gen"
import type { TickerArticles } from "@/api/generated/dtos/tickerArticles.gen"
import type { TickerArticlesSourcesItem } from "@/api/generated/dtos/tickerArticlesSourcesItem.gen"
import type { SourceResult } from "@/api/generated/dtos/sourceResult.gen"
import type { SearchError } from "@/api/generated/dtos/searchError.gen"
import { readNdjson } from "@/lib/ndjson"
import { assertStreamOk } from "@/lib/api-error"
import type { Stock } from "@/models/Stock"
import type { Article } from "@/models/Article"
import type {
  StockSource,
  ArticleSource,
  SentimentSource,
} from "@/hooks/useStockPipeline"

type PipelineInput =
  | { q: string }
  | { tickerIds: string[] }
  | { trending: true }

// ── Stage 1 ──────────────────────────────────────────────────────────────────

export function searchStocksSource(input: PipelineInput): StockSource {
  return async function* (signal) {
    let res:
      | Awaited<ReturnType<typeof getApiTickers>>
      | Awaited<ReturnType<typeof getApiTickersTrending>>

    if ("trending" in input) {
      res = await getApiTickersTrending({ signal })
    } else {
      res = await getApiTickers(
        "q" in input ? { q: input.q } : { tickerIds: input.tickerIds },
        { signal }
      )
    }
    if (signal.aborted) return
    assertStreamOk(res, "Search failed")

    yield* readNdjson<ApiStock | SearchError>(
      (res as unknown as { stream: Response }).stream,
      signal
    )
  }
}

export function peersStocksSource(ticker: string): StockSource {
  return async function* (signal) {
    const res = await getApiTickersTickerIdPeers(ticker, { signal })
    if (signal.aborted) return
    assertStreamOk(res, "Could not load competitors")

    yield* readNdjson<ApiStock | SearchError>(
      (res as unknown as { stream: Response }).stream,
      signal
    )
  }
}

export function passthroughStocksSource(stocks: Stock[]): StockSource {
  return async function* () {
    for (const s of stocks) yield s
  }
}

// ── Article mapping ───────────────────────────────────────────────────────────

export function mapArticles(sources: TickerArticlesSourcesItem[]): Article[] {
  return sources.map((s) => ({
    url: s.url,
    title: s.title ?? "",
    body: s.body ?? "",
    updatedAtSec: s.updatedAtSec,
    scrapedAtSec: s.scrapedAtSec,
  }))
}

// ── Stage 2 ──────────────────────────────────────────────────────────────────

export const articlesSource: ArticleSource = async function* (ticker, signal) {
  const res = await getApiTickersTickerIdArticles(ticker, {}, { signal })
  if (signal.aborted || res.status !== 200) return

  for await (const item of readNdjson<TickerArticles | SearchError>(
    (res as unknown as { stream: Response }).stream,
    signal
  )) {
    if (signal.aborted) return
    if ("error" in item) {
      yield item as SearchError
      return
    }
    yield mapArticles((item as TickerArticles).sources)
  }
}

// ── Stage 3 ──────────────────────────────────────────────────────────────────

export const sentimentSource: SentimentSource = async function* (
  ticker,
  urls,
  signal
) {
  const res = await getApiTickersTickerIdArticlesSentiment(
    ticker,
    { articleUrl: urls },
    { signal }
  )
  if (signal.aborted || res.status !== 200) return

  yield* readNdjson<SourceResult | SearchError>(
    (res as unknown as { stream: Response }).stream,
    signal
  )
}
