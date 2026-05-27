"""Benchmark different hypothesis pairs for the NLI sentiment scorer.

Run from the analyzer/ directory:
    python scripts/benchmark_hypotheses.py

Scores a fixed set of clearly positive and clearly negative financial
snippets against several candidate hypothesis pairs and prints a
comparison table.  The "winner" is the pair with the largest spread
(avg_pos − avg_neg) while keeping correct polarity on every snippet.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Make `src.scorer` importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.scorer import SentimentScorer  # noqa: E402

MODEL_NAME = os.getenv("MODEL_NAME", "cross-encoder/nli-deberta-v3-base")

# ── Hypothesis pairs to compare ────────────────────────────────────────────
HYPOTHESIS_PAIRS: list[tuple[str, str, str]] = [
    (
        "current default",
        "This is positive news for investors.",
        "This is negative news for investors.",
    ),
    (
        "stock price direction",
        "The company's stock price will go up.",
        "The company's stock price will go down.",
    ),
    (
        "good/bad for company",
        "This is good news for the company.",
        "This is bad news for the company.",
    ),
    (
        "buy/sell signal",
        "Investors should buy this stock.",
        "Investors should sell this stock.",
    ),
]

# ── Curated test snippets (paraphrases of real financial headlines) ───────
POSITIVE_SNIPPETS: list[str] = [
    "Apple beats earnings expectations and announces record stock buyback, sending shares to all-time highs.",
    "Microsoft reports blockbuster cloud growth and raises full-year revenue guidance.",
    "Tesla deliveries surge past analyst forecasts as production hits record levels.",
    "NVIDIA posts massive revenue beat driven by surging AI chip demand.",
    "Amazon's retail and AWS segments both grow double-digits, beating Wall Street estimates.",
    "Google parent Alphabet smashes Q3 expectations, lifted by strong ad spending.",
    "Pfizer announces successful Phase 3 trial results and FDA approval for new drug.",
    "Boeing wins record $20 billion order from major airline, lifting shares sharply.",
]

NEGATIVE_SNIPPETS: list[str] = [
    "Boeing faces SEC investigation over safety failures and massive lawsuits as orders collapse.",
    "Meta tumbles after weak ad revenue and disappointing guidance for next quarter.",
    "Wells Fargo fined billions over fraudulent accounts scandal as profits plunge.",
    "Ford recalls millions of vehicles over fire risk; shares fall on cost concerns.",
    "Intel misses earnings badly and slashes dividend, signaling deep operational troubles.",
    "Netflix loses subscribers for second straight quarter, shares drop sharply.",
    "Bed Bath & Beyond files for bankruptcy after failed turnaround attempts.",
    "FAA grounds airline fleet following multiple safety incidents and equipment failures.",
]


@dataclass
class PairResult:
    name: str
    avg_pos: float
    avg_neg: float
    spread: float
    polarity_correct: int  # count of snippets where polarity is correct
    polarity_total: int
    max_magnitude: float


def evaluate(scorer: SentimentScorer, name: str) -> PairResult:
    pos_scores = scorer.score_batch(POSITIVE_SNIPPETS)
    neg_scores = scorer.score_batch(NEGATIVE_SNIPPETS)

    avg_pos = sum(pos_scores) / len(pos_scores)
    avg_neg = sum(neg_scores) / len(neg_scores)

    correct = sum(1 for s in pos_scores if s > 0) + sum(1 for s in neg_scores if s < 0)
    total = len(pos_scores) + len(neg_scores)
    max_mag = max(abs(s) for s in pos_scores + neg_scores)

    return PairResult(
        name=name,
        avg_pos=avg_pos,
        avg_neg=avg_neg,
        spread=avg_pos - avg_neg,
        polarity_correct=correct,
        polarity_total=total,
        max_magnitude=max_mag,
    )


def print_per_snippet_scores(scorer: SentimentScorer, name: str) -> None:
    print(f"\n  Per-snippet detail for '{name}':")
    pos_scores = scorer.score_batch(POSITIVE_SNIPPETS)
    neg_scores = scorer.score_batch(NEGATIVE_SNIPPETS)
    for i, (snippet, score) in enumerate(zip(POSITIVE_SNIPPETS, pos_scores)):
        mark = "✓" if score > 0 else "✗"
        print(f"    [+{i+1}] {mark} {score:+.4f}  {snippet[:70]}...")
    for i, (snippet, score) in enumerate(zip(NEGATIVE_SNIPPETS, neg_scores)):
        mark = "✓" if score < 0 else "✗"
        print(f"    [-{i+1}] {mark} {score:+.4f}  {snippet[:70]}...")


def main() -> None:
    print(f"Loading model: {MODEL_NAME}")
    print(f"Test set: {len(POSITIVE_SNIPPETS)} positive + {len(NEGATIVE_SNIPPETS)} negative snippets")
    print(f"Testing {len(HYPOTHESIS_PAIRS)} hypothesis pairs...\n")

    results: list[PairResult] = []
    for name, h_pos, h_neg in HYPOTHESIS_PAIRS:
        print(f"  Scoring '{name}'...")
        scorer = SentimentScorer(MODEL_NAME, h_pos, h_neg)
        results.append(evaluate(scorer, name))

    # ── Summary table ──────────────────────────────────────────────────────
    print("\n" + "=" * 88)
    print(f"{'pair':<24} {'avg_pos':>10} {'avg_neg':>10} {'spread':>10} {'max|s|':>10} {'polarity':>14}")
    print("-" * 88)
    for r in results:
        polarity_str = f"{r.polarity_correct}/{r.polarity_total}"
        print(
            f"{r.name:<24} {r.avg_pos:>+10.4f} {r.avg_neg:>+10.4f} {r.spread:>10.4f} "
            f"{r.max_magnitude:>10.4f} {polarity_str:>14}"
        )
    print("=" * 88)

    # ── Pick a winner ──────────────────────────────────────────────────────
    # Winner = correct polarity on all snippets, then largest spread.
    fully_correct = [r for r in results if r.polarity_correct == r.polarity_total]
    pool = fully_correct if fully_correct else results
    winner = max(pool, key=lambda r: r.spread)

    print(f"\nWinner: '{winner.name}' (spread={winner.spread:.4f}, "
          f"polarity={winner.polarity_correct}/{winner.polarity_total})")

    # ── Per-snippet detail for the winning pair (sanity check) ─────────────
    h_pos, h_neg = next((p, n) for name, p, n in HYPOTHESIS_PAIRS if name == winner.name)
    scorer = SentimentScorer(MODEL_NAME, h_pos, h_neg)
    print_per_snippet_scores(scorer, winner.name)


if __name__ == "__main__":
    main()
