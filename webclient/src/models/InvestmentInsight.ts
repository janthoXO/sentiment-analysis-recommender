export type InvestmentInsight = {
  verdict: "bullish" | "bearish" | "neutral" | "mixed"
  confidence: "low" | "medium" | "high"
  summary: string
  reasons: string[]
  disclaimer: string
}
