import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react"
import type { ReactNode } from "react"
import { useAuth } from "./auth-provider.js"
import { toast } from "sonner"
import type { List, TickerResult } from "@/api/generated/dtos/index.js"
import {
  getApiLists,
  postApiLists,
  patchApiListsId,
  deleteApiListsId,
  postApiListsIdItems,
  deleteApiListsIdItemsTicker,
  getApiTickersSentiment,
} from "@/api/generated/sentimentSearchAPI.gen.js"
import { readStream } from "@/lib/stream.js"

const DIVERGENCE_THRESHOLD = 0.2

export interface WatchlistEvent {
  id: number
  result: TickerResult
}

interface WatchlistContextType {
  lists: List[]
  tickerResults: Record<string, TickerResult>
  events: WatchlistEvent[]
  refresh: () => Promise<void>
  createList: (name: string) => Promise<List | null>
  renameList: (id: string, name: string) => Promise<void>
  deleteList: (id: string) => Promise<void>
  addToList: (listId: string, ticker: string) => Promise<void>
  removeFromList: (listId: string, ticker: string) => Promise<void>
  listsContainingTicker: (ticker: string) => List[]
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(
  undefined
)

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth()
  const [lists, setLists] = useState<List[]>([])
  const [tickerResults, setTickerResults] = useState<
    Record<string, TickerResult>
  >({})
  const [events, setEvents] = useState<WatchlistEvent[]>([])

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${token}` }),
    [token]
  )

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setLists([])
      return
    }
    try {
      const res = await getApiLists({ headers: authHeaders() })
      if (res.data) setLists(res.data)
    } catch (err) {
      console.error("Failed to fetch lists:", err)
    }
  }, [isAuthenticated, authHeaders])

  useEffect(() => {
    void (async () => {
      refresh()
    })()
  }, [refresh])

  // Hydrate tickerResults whenever lists change
  useEffect(() => {
    if (!isAuthenticated || lists.length === 0) return

    const uniqueTickers = [
      ...new Set(lists.flatMap((l) => l.items.map((i) => i.ticker))),
    ]
    if (uniqueTickers.length === 0) return

    void (async () => {
      try {
        const res = await getApiTickersSentiment(
          { tickerIds: uniqueTickers },
          { headers: authHeaders() }
        )
        if (res.status === 200) {
          const map: Record<string, TickerResult> = {}
          await readStream(res.stream, (parsedObj) => {
            if (!("error" in parsedObj)) {
              const r = parsedObj as TickerResult
              map[r.stock.ticker] = r
            }
          })
          setTickerResults(map)
        }
      } catch (err) {
        console.error("Failed to hydrate ticker results:", err)
      }
    })()
  }, [lists, isAuthenticated, authHeaders])

  // SSE for real-time sentiment updates
  useEffect(() => {
    if (!isAuthenticated || !token) return
    const eventSource = new EventSource(`/api/lists/stream?token=${token}`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        if (data.type === "TICKER_UPDATE") {
          const fresh: TickerResult = data.payload
          const ticker = fresh.stock.ticker

          setTickerResults((prev) => {
            const prevResult = prev[ticker]
            if (
              prevResult &&
              Math.abs(fresh.avgScore - prevResult.avgScore) >=
                DIVERGENCE_THRESHOLD
            ) {
              toast.message(`Sentiment Alert: ${ticker}`, {
                description: `Score changed from ${prevResult.avgScore.toFixed(2)} to ${fresh.avgScore.toFixed(2)}`,
              })
            }
            return { ...prev, [ticker]: fresh }
          })

          setEvents((prev) =>
            [{ id: Date.now(), result: fresh }, ...prev].slice(0, 50)
          )
        }
      } catch (err) {
        console.error("SSE parse error", err)
      }
    }

    eventSource.onerror = (err) => console.error("SSE Error:", err)
    return () => eventSource.close()
  }, [isAuthenticated, token])

  const createList = useCallback(
    async (name: string): Promise<List | null> => {
      try {
        const res = await postApiLists({ name }, { headers: authHeaders() })
        if (res.status === 200 && res.data) {
          setLists((prev) => [...prev, res.data as List])
          return res.data as List
        }
      } catch (err) {
        console.error("Create list error:", err)
      }
      return null
    },
    [authHeaders]
  )

  const renameList = useCallback(
    async (id: string, name: string) => {
      try {
        await patchApiListsId(id, { name }, { headers: authHeaders() })
        setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)))
      } catch (err) {
        console.error("Rename list error:", err)
      }
    },
    [authHeaders]
  )

  const deleteList = useCallback(
    async (id: string) => {
      try {
        await deleteApiListsId(id, { headers: authHeaders() })
        setLists((prev) => prev.filter((l) => l.id !== id))
      } catch (err) {
        console.error("Delete list error:", err)
      }
    },
    [authHeaders]
  )

  const addToList = useCallback(
    async (listId: string, ticker: string) => {
      try {
        await postApiListsIdItems(
          listId,
          { ticker },
          { headers: authHeaders() }
        )
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId && !l.items.some((i) => i.ticker === ticker)
              ? { ...l, items: [...l.items, { ticker }] }
              : l
          )
        )
      } catch (err) {
        console.error("Add to list error:", err)
      }
    },
    [authHeaders]
  )

  const removeFromList = useCallback(
    async (listId: string, ticker: string) => {
      try {
        await deleteApiListsIdItemsTicker(listId, ticker, {
          headers: authHeaders(),
        })
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? { ...l, items: l.items.filter((i) => i.ticker !== ticker) }
              : l
          )
        )
      } catch (err) {
        console.error("Remove from list error:", err)
      }
    },
    [authHeaders]
  )

  const listsContainingTicker = useCallback(
    (ticker: string) =>
      lists.filter((l) => l.items.some((i) => i.ticker === ticker)),
    [lists]
  )

  return (
    <WatchlistContext.Provider
      value={{
        lists,
        tickerResults,
        events,
        refresh,
        createList,
        renameList,
        deleteList,
        addToList,
        removeFromList,
        listsContainingTicker,
      }}
    >
      {children}
    </WatchlistContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useWatchlistContext = () => {
  const context = useContext(WatchlistContext)
  if (context === undefined) {
    throw new Error(
      "useWatchlistContext must be used within a WatchlistProvider"
    )
  }
  return context
}
