import { Button } from "@/components/ui/button"
import { useState } from "react"

interface SearchBarProps {
  onSearch: (ticker: string) => void
  loading: boolean
}

export function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [value, setValue] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const ticker = value.trim().toUpperCase()
    if (ticker) {
      onSearch(ticker)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 flex w-full max-w-sm items-center space-x-2"
    >
      <input
        type="text"
        placeholder="Enter Stock Ticker (e.g. AAPL)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={loading}
        className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Button type="submit" disabled={loading || !value.trim()}>
        {loading ? "Searching..." : "Search"}
      </Button>
    </form>
  )
}
