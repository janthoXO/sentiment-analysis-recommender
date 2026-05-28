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
import type { List } from "@/api/generated/dtos/index.js"
import type { NotificationEvent } from "@/api/generated/dtos/notificationEvent.gen.js"
import {
  getApiLists,
  getApiNotificationsStream,
  postApiLists,
  patchApiListsId,
  deleteApiListsId,
  postApiListsIdItems,
  deleteApiListsIdItemsTicker,
} from "@/api/generated/sentimentSearchAPI.gen.js"
import { readStream } from "@/lib/stream.js"
import { toastApiError } from "@/lib/api-error.js"

const DIVERGENCE_THRESHOLD = 0.2

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

  // NDJSON stream for real-time per-ticker sentiment notifications
  useEffect(() => {
    if (!isAuthenticated || !token) return
    const ctrl = new AbortController()

    void (async () => {
      try {
        const res = await getApiNotificationsStream({
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${token}` },
        })
        if (ctrl.signal.aborted || res.status !== 200) return

        await readStream(
          (res as unknown as { stream: Response }).stream,
          (parsed) => {
            if (ctrl.signal.aborted) return
            const event = parsed as NotificationEvent
            if (!event.ticker || !Array.isArray(event.latest)) return

            const { ticker, before, latest } = event
            if (latest.length === 0) return

            const avgLatest =
              latest.reduce((sum, s) => sum + s.score, 0) / latest.length
            const now = Date.now()

            if (before.length === 0) {
              toast.message(`Sentiment Alert: ${ticker}`, {
                description: `Current score: ${avgLatest.toFixed(2)}`,
              })
              setAlerts((prev) =>
                [{ id: now, ticker, avgScore: avgLatest }, ...prev].slice(0, 50)
              )
              return
            }

            const avgBefore =
              before.reduce((sum, s) => sum + s.score, 0) / before.length

            if (Math.abs(avgLatest - avgBefore) >= DIVERGENCE_THRESHOLD) {
              toast.message(`Sentiment Alert: ${ticker}`, {
                description: `Score changed from ${avgBefore.toFixed(2)} to ${avgLatest.toFixed(2)}`,
              })
              setAlerts((prev) =>
                [{ id: now, ticker, avgScore: avgLatest }, ...prev].slice(0, 50)
              )
            }
          }
        )
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        console.error("Notification stream error:", e)
        toast.error("Real-time updates disconnected", {
          description: "Sentiment alerts may be delayed.",
        })
      }
    })()

    return () => ctrl.abort()
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
