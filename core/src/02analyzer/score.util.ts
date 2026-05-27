import type { SourceResultRoot } from "@/generated/in/index.js";

export function calculateAverageScore(results: SourceResultRoot[]): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + r.score, 0) / results.length;
}
