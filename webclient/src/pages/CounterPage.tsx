import { useCounter } from "../context/CounterContext"
import { Button } from "../components/ui/button"

export function CounterPage() {
  const { count, isLoading, increment, decrement } = useCounter()

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <p className="animate-pulse text-muted-foreground">
          Loading counter...
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1.5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Counter</h2>
          <p className="text-sm text-muted-foreground">
            A simple counter state example.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 py-8">
          <div className="text-7xl font-bold tracking-tighter tabular-nums">
            {count}
          </div>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="lg"
            onClick={decrement}
            className="flex-1 text-2xl"
            aria-label="Decrease counter"
          >
            -
          </Button>
          <Button
            size="lg"
            onClick={increment}
            className="flex-1 text-2xl"
            aria-label="Increase counter"
          >
            +
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CounterPage
