/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { fetchCounter } from "@/api/counter.api"

interface CounterContextType {
  count: number
  isLoading: boolean
  increment: () => void
  decrement: () => void
}

const CounterContext = createContext<CounterContextType | undefined>(undefined)

export function CounterProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    fetchCounter()
      .then((data) => {
        setCount(data.amount)
      })
      .catch((err) => {
        console.error("Failed to fetch counter, falling back to 0:", err)
        setCount(0) // fallback on failure
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  const increment = () => setCount((c) => c + 1)
  const decrement = () => setCount((c) => c - 1)

  return (
    <CounterContext.Provider value={{ count, isLoading, increment, decrement }}>
      {children}
    </CounterContext.Provider>
  )
}

export function useCounter() {
  const context = useContext(CounterContext)
  if (context === undefined) {
    throw new Error("useCounter must be used within a CounterProvider")
  }
  return context
}
