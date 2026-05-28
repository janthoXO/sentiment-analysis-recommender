import { useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { ResultCard } from "@/components/ResultCard"
import { useStockStream } from "@/hooks/useStockStream"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function SearchPage() {
  const { results, loading, search } = useStockStream()
  const [searchParams, setSearchParams] = useSearchParams()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const newQ = formData.get("q") as string
    if (newQ) setSearchParams({ q: newQ })
  }

  const q = searchParams.get("q")

  useEffect(() => {
    if (q === null || q.trim() === "") return
    search({ q })
  }, [q, search])

  return (
    <div className="flex w-full flex-col items-center">
      <form
        onSubmit={handleSubmit}
        className="mb-6 flex w-full max-w-sm items-center gap-2"
        role="search"
      >
        <Input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Enter Stock Ticker (e.g. AAPL)"
          disabled={loading}
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </Button>
      </form>

      {q && (
        <p className="mb-4 text-sm text-muted-foreground">
          Results for <span className="font-medium text-foreground">{q}</span>
        </p>
      )}

      <div className="mt-4 grid w-full max-w-4xl grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
        {results.map((res) => (
          <ResultCard
            key={res.stock.ticker}
            ticker={res.stock.ticker}
            avgScore={res.avgScore}
            articleCount={res.sources.length}
            sources={res.sources}
          />
        ))}
      </div>

      {!loading && q && results.length === 0 && (
        <p className="mt-12 text-muted-foreground">No results found.</p>
      )}
    </div>
  )
}
