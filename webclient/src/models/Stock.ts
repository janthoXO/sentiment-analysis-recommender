import type { Article } from "./Article"

export type Stock = {
  ticker: string
  name: string
  sector?: string
  industry?: string
  exchange?: string
  articles?: Article[]
  avgScore?: number
}
