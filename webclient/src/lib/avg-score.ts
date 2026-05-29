import type { Article } from "@/models/Article"

export function computeAvg(articles?: Article[]): number | undefined {
  if (!articles || articles.length === 0) return undefined
  let sum = 0
  let scoredCount = 0
  for (const a of articles) {
    if (a.score != null) {
      sum += a.score
      scoredCount++
    }
  }
  return scoredCount > 0 ? sum / scoredCount : undefined
}
