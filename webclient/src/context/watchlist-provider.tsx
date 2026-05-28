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
import type { List } from "@/api/generated/dtos/index.js"
import type { SourceResult } from "@/api/generated/dtos/sourceResult.gen.js"
import {
  getApiLists,
  postApiLists,
  patchApiListsId,
  deleteApiListsId,
  postApiListsIdItems,
  deleteApiListsIdItemsTicker,
} from "@/api/generated/sentimentSearchAPI.gen.js"
import { toastApiError } from "@/lib/api-error.js"

const DIVERGENCE_THRESHOLD = 0.2
const NOTIFY_INTERVAL_MS = 30_000

export interface WatchlistAlert {
  id: number
  ticker: string
  avgScore: number
}

interface WatchlistContextType {
  lists: List[]
  alerts: WatchlistAlert[]
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
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([])
  const sseErrorToastedRef = useRef(false)

  // ticker → { score, notifiedAt } for throttled alerts
  const lastNotifiedRef = useRef<
    Map<string, { score: number; notifiedAt: number }>
  >(new Map())
  // ticker → running avg score built from per-article SSE events
  const tickerScoresRef = useRef<Map<string, Map<string, number>>>(new Map())

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
      await refresh()
    })()
  }, [refresh])

  // SSE for real-time per-article sentiment updates
  useEffect(() => {
    if (!isAuthenticated || !token) return
    sseErrorToastedRef.current = false
    const eventSource = new EventSource(`/api/lists/stream?token=${token}`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string
          ticker?: string
          source?: SourceResult
          avgScore?: number
        }

        if (
          data.type === "SOURCE_UPDATE" &&
          data.ticker &&
          data.source != null &&
          data.avgScore != null
        ) {
          const { ticker, source, avgScore } = data as {
            ticker: string
            source: SourceResult
            avgScore: number
          }

          // Update our running score map
          const scoreMap =
            tickerScoresRef.current.get(ticker) ?? new Map<string, number>()
          scoreMap.set(source.url, source.score)
          tickerScoresRef.current.set(ticker, scoreMap)

          // Throttled notification: fire only if enough time has passed AND score diff is large
          const prev = lastNotifiedRef.current.get(ticker)
          const now = Date.now()
          if (
            (!prev || now - prev.notifiedAt >= NOTIFY_INTERVAL_MS) &&
            (!prev || Math.abs(avgScore - prev.score) >= DIVERGENCE_THRESHOLD)
          ) {
            const prevScore = prev?.score
            toast.message(`Sentiment Alert: ${ticker}`, {
              description:
                prevScore != null
                  ? `Score changed from ${prevScore.toFixed(2)} to ${avgScore.toFixed(2)}`
                  : `Current score: ${avgScore.toFixed(2)}`,
            })
            lastNotifiedRef.current.set(ticker, {
              score: avgScore,
              notifiedAt: now,
            })
            setAlerts((prev) =>
              [{ id: now, ticker, avgScore }, ...prev].slice(0, 50)
            )
          }
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
        alerts,
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
