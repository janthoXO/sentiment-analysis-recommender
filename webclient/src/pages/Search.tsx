import { useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { SearchBar } from "@/components/SearchBar"
import { ResultCard } from "@/components/ResultCard"
import { useStockStream } from "@/hooks/useStockStream"

export default function SearchPage() {
  const { results, loading, search } = useStockStream()
  const [searchParams, setSearchParams] = useSearchParams()

  const q = searchParams.get("q")
  const lastSearchedRef = useRef<string | null>(null)

  useEffect(() => {
    if (q && q !== lastSearchedRef.current) {
      lastSearchedRef.current = q
      search(q)
    }
  }, [q, search])

  const handleSearch = (query: string) => {
    if (query) {
      setSearchParams({ q: query })
    } else {
      setSearchParams({})
    }
  }

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

      <SearchBar onSearch={handleSearch} loading={loading} />

      <div className="mt-8 grid w-full max-w-4xl grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
        {results.map((res) => (
          <ResultCard
            key={res.ticker}
            ticker={res.ticker}
            avgScore={res.avgScore}
            articleCount={res.articleCount}
          />
        ))}
      </div>
    </div>
  )
}
