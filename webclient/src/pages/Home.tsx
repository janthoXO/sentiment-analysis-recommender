import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEffect } from "react"
import { useSearchPipeline } from "@/hooks/useSearchPipeline"
import { ResultCard } from "@/components/ResultCard"

export default function HomePage() {
  const navigate = useNavigate()
  const { resultsByTicker, order, search } = useSearchPipeline()

  useEffect(() => {
    search({ trending: true })
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

      {order.length > 0 && (
        <section aria-label="Trending stocks" className="w-full max-w-4xl">
          <h2 className="mb-4 text-xl font-semibold text-muted-foreground">
            Trending
          </h2>
          <div className="grid w-full grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
            {order.map((ticker) => {
              const state = resultsByTicker.get(ticker)
              if (!state) return null
              return (
                <ResultCard
                  key={ticker}
                  stock={state.stock}
                  articles={state.articles}
                  scoresByUrl={state.scoresByUrl}
                  avgScore={state.avgScore}
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
