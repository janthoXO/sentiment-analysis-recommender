import type { Stock } from "./Stock"

export type WatchlistItem = {
  listId: string
  ticker: string
  stock?: Stock
}

export type Watchlist = {
  id: string
  userId: string
  name: string
  createdAtSec: number
  items?: WatchlistItem[]
}
