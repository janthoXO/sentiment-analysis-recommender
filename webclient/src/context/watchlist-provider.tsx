import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
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
import { toastApiError } from "@/lib/api-error.js"

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
  const sseErrorToastedRef = useRef(false)

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
      if (res.status === 200 && res.data) {
        setLists(res.data)
      } else if (res.status !== 200) {
        toastApiError("Could not load watchlists", res)
      }
    } catch (err) {
      toastApiError("Could not load watchlists", err)
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
        } else {
          toastApiError("Could not load watchlist sentiment", res)
        }
      } catch (err) {
        toastApiError("Could not load watchlist sentiment", err)
      }
    })()
  }, [lists, isAuthenticated, authHeaders])

  // SSE for real-time sentiment updates
  useEffect(() => {
    if (!isAuthenticated || !token) return
    sseErrorToastedRef.current = false
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

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err)
      if (!sseErrorToastedRef.current) {
        sseErrorToastedRef.current = true
        toast.error("Real-time updates disconnected", {
          description: "Sentiment alerts may be delayed.",
        })
      }
    }
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
        toastApiError("Could not create list", res)
      } catch (err) {
        toastApiError("Could not create list", err)
      }
      return null
    },
    [authHeaders]
  )

  const renameList = useCallback(
    async (id: string, name: string) => {
      try {
        const res = await patchApiListsId(
          id,
          { name },
          { headers: authHeaders() }
        )
        if (res.status === 200) {
          setLists((prev) =>
            prev.map((l) => (l.id === id ? { ...l, name } : l))
          )
        } else {
          toastApiError("Could not rename list", res)
        }
      } catch (err) {
        toastApiError("Could not rename list", err)
      }
    },
    [authHeaders]
  )

  const deleteList = useCallback(
    async (id: string) => {
      try {
        const res = await deleteApiListsId(id, { headers: authHeaders() })
        if (res.status === 200) {
          setLists((prev) => prev.filter((l) => l.id !== id))
        } else {
          toastApiError("Could not delete list", res)
        }
      } catch (err) {
        toastApiError("Could not delete list", err)
      }
    },
    [authHeaders]
  )

  const addToList = useCallback(
    async (listId: string, ticker: string) => {
      try {
        const res = await postApiListsIdItems(
          listId,
          { ticker },
          { headers: authHeaders() }
        )
        if (res.status === 200) {
          setLists((prev) =>
            prev.map((l) =>
              l.id === listId && !l.items.some((i) => i.ticker === ticker)
                ? { ...l, items: [...l.items, { ticker }] }
                : l
            )
          )
        } else {
          toastApiError("Could not add ticker to list", res)
        }
      } catch (err) {
        toastApiError("Could not add ticker to list", err)
      }
    },
    [authHeaders]
  )

  const removeFromList = useCallback(
    async (listId: string, ticker: string) => {
      try {
        const res = await deleteApiListsIdItemsTicker(listId, ticker, {
          headers: authHeaders(),
        })
        if (res.status === 200) {
          setLists((prev) =>
            prev.map((l) =>
              l.id === listId
                ? { ...l, items: l.items.filter((i) => i.ticker !== ticker) }
                : l
            )
          )
        } else {
          toastApiError("Could not remove ticker from list", res)
        }
      } catch (err) {
        toastApiError("Could not remove ticker from list", err)
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
