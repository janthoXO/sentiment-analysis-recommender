import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEffect, useState } from "react"
import { getApiTickersTrending } from "@/api/generated/sentimentSearchAPI.gen"
import { useStockStream } from "@/hooks/useStockStream"
import { ResultCard } from "@/components/ResultCard"
import type { Stock } from "@/api/generated/dtos"
import { toastApiError } from "@/lib/api-error"

export default function HomePage() {
  const navigate = useNavigate()
  const [trendingStocks, setTrendingStocks] = useState<Stock[]>([])
  const { results, search } = useStockStream()

  useEffect(() => {
    getApiTickersTrending()
      .then((res) => {
        if (
          res.status === 200 &&
          Array.isArray(res.data) &&
          res.data.length > 0
        ) {
          setTrendingStocks(res.data)
          search({ tickerIds: res.data.map((s) => s.ticker) })
        } else if (res.status !== 200) {
          toastApiError("Could not load trending stocks", res)
        }
      })
      .catch((e) => toastApiError("Could not load trending stocks", e))
  }, [search])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const q = (formData.get("q") as string).trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div className="flex w-full flex-col items-center">
      <div className="mb-8 w-full max-w-4xl space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-primary">
          Sentinel Finance
        </h1>
        <p className="text-lg text-muted-foreground">
          Real-time NLP sentiment analysis for equities.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mb-12 flex w-full max-w-sm items-center gap-2"
        role="search"
      >
        <Input
          type="text"
          name="q"
          placeholder="Enter Stock Ticker (e.g. AAPL)"
          autoFocus
        />
        <Button type="submit">Search</Button>
      </form>

      {trendingStocks.length > 0 && (
        <section aria-label="Trending stocks" className="w-full max-w-4xl">
          <h2 className="mb-4 text-xl font-semibold text-muted-foreground">
            Trending
          </h2>
          <div className="grid w-full grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
            {trendingStocks.map((stock) => {
              const result = results.find(
                (r) => r.stock?.ticker === stock.ticker
              )
              return result ? (
                <ResultCard
                  key={stock.ticker}
                  ticker={result.stock.ticker}
                  avgScore={result.avgScore}
                  articleCount={result.sources.length}
                  sources={result.sources}
                />
              ) : (
                <div
                  key={stock.ticker}
                  className="flex h-40 w-full max-w-sm items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground"
                >
                  {stock.name || stock.ticker}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
