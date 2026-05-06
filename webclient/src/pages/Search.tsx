import { useEffect } from "react"
import { Form, useSearchParams } from "react-router-dom"
import { ResultCard } from "@/components/ResultCard"
import { useStockStream } from "@/hooks/useStockStream"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function SearchPage() {
  const { results, loading, search } = useStockStream()
  const [searchParams] = useSearchParams()
  const q = searchParams.get("q")

  useEffect(() => {
    if (q === null || q.trim() === "") return
    search(q)
  }, [q, search])

  return (
    <div className="flex w-full flex-col items-center">
      <div className="mb-12 w-full max-w-4xl space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-primary">
          Sentinel Finance
        </h1>
        <p className="text-lg text-muted-foreground">
          Real-time NLP sentiment analysis for equities.
        </p>
      </div>

      <Form
        className="mb-6 flex w-full max-w-sm items-center space-x-2"
        role="search"
      >
        {/* 2. Use shadcn's Input for the beautiful UI */}
        <Input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Enter Stock Ticker (e.g. AAPL)"
          disabled={loading}
        />

        {/* 3. Use shadcn's Button */}
        <Button type="submit" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </Button>
      </Form>

      <div className="mt-8 grid w-full max-w-4xl grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
        {results.map((res) => (
          <ResultCard
            key={res.stock.ticker}
            ticker={res.stock.ticker}
            avgScore={res.avgScore}
            articleCount={res.sources.length}
          />
        ))}
      </div>
    </div>
  )
}
