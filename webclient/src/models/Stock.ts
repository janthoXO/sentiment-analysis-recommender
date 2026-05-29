import type { Article } from "./Article"

export type Stock = {
  ticker: string
  name: string
  articles?: Article[]
  avgScore?: number
}
