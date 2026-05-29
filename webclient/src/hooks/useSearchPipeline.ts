import { useCallback } from "react"
import { useStockPipeline } from "@/hooks/useStockPipeline"
import {
  searchStocksSource,
  articlesSource,
  sentimentSource,
} from "@/hooks/sources"

export type { TickerStage, TickerState } from "@/hooks/useStockPipeline"

type PipelineInput =
  | { q: string }
  | { tickerIds: string[] }
  | { trending: true }

export function useSearchPipeline() {
  const { run, reset, resultsByTicker, order, loading, error } =
    useStockPipeline({
      articles: articlesSource,
      sentiment: sentimentSource,
    })

  const search = useCallback(
    (input: PipelineInput) => run(searchStocksSource(input)),
    [run]
  )

  const restart = useCallback(() => reset(), [reset])

  return { resultsByTicker, order, loading, error, search, restart }
}
