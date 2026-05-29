import { useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { ResultCard } from "@/components/ResultCard"
import { useSearchPipeline } from "@/hooks/useSearchPipeline"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ResultCardSkeleton } from "@/components/ResultCardSkeleton"

export default function SearchPage() {
  const { resultsByTicker, order, loading, search } = useSearchPipeline()
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
        {loading && order.length === 0 && <ResultCardSkeleton />}

        {order.map((ticker) => {
          const state = resultsByTicker.get(ticker)
          if (!state) return null
          return <ResultCard key={ticker} stock={state.stock} />
        })}
      </div>

      {!loading && q && order.length === 0 && (
        <p className="mt-12 text-muted-foreground">No results found.</p>
      )}
    </div>
  )
}
