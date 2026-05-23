"""Benchmark the NLI scorer against the FinBERT scorer on a shared test set.

Run from the analyzer/ directory:
    python scripts/benchmark_scorers.py

Reuses the curated positive/negative snippets from benchmark_hypotheses.py and
scores them with both backends so we can compare spread, polarity accuracy, and
how bimodal each backend is. Satisfies the benchmark acceptance criterion of
issue #23.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Make `src.*` and sibling scripts importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.benchmark_hypotheses import (  # noqa: E402
    NEGATIVE_SNIPPETS,
    POSITIVE_SNIPPETS,
)
from src.scorer import BaseScorer, FinbertScorer, NliScorer  # noqa: E402

# Use the tuned hypotheses (issue #21 winner) for a fair NLI baseline.
NLI_MODEL = os.getenv("NLI_MODEL", "cross-encoder/nli-deberta-v3-base")
NLI_HYP_POS = os.getenv("HYPOTHESIS_POSITIVE", "The company's stock price will go up.")
NLI_HYP_NEG = os.getenv("HYPOTHESIS_NEGATIVE", "The company's stock price will go down.")
FINBERT_MODEL = os.getenv("FINBERT_MODEL", "ProsusAI/finbert")


@dataclass
class ScorerResult:
    name: str
    avg_pos: float
    avg_neg: float
    spread: float
    polarity_correct: int
    polarity_total: int
    max_magnitude: float
    near_zero: int  # count of snippets with |score| < 0.05 (bimodality proxy)


def evaluate(scorer: BaseScorer, name: str) -> ScorerResult:
    pos_scores = scorer.score_batch(POSITIVE_SNIPPETS)
    neg_scores = scorer.score_batch(NEGATIVE_SNIPPETS)

    avg_pos = sum(pos_scores) / len(pos_scores)
    avg_neg = sum(neg_scores) / len(neg_scores)

    correct = sum(1 for s in pos_scores if s > 0) + sum(1 for s in neg_scores if s < 0)
    total = len(pos_scores) + len(neg_scores)
    all_scores = pos_scores + neg_scores
    max_mag = max(abs(s) for s in all_scores)
    near_zero = sum(1 for s in all_scores if abs(s) < 0.05)

    return ScorerResult(
        name=name,
        avg_pos=avg_pos,
        avg_neg=avg_neg,
        spread=avg_pos - avg_neg,
        polarity_correct=correct,
        polarity_total=total,
        max_magnitude=max_mag,
        near_zero=near_zero,
    )


def print_per_snippet(scorer: BaseScorer, name: str) -> None:
    print(f"\n  Per-snippet detail for '{name}':")
    pos_scores = scorer.score_batch(POSITIVE_SNIPPETS)
    neg_scores = scorer.score_batch(NEGATIVE_SNIPPETS)
    for i, (snippet, score) in enumerate(zip(POSITIVE_SNIPPETS, pos_scores)):
        mark = "✓" if score > 0 else "✗"
        print(f"    [+{i+1}] {mark} {score:+.4f}  {snippet[:66]}...")
    for i, (snippet, score) in enumerate(zip(NEGATIVE_SNIPPETS, neg_scores)):
        mark = "✓" if score < 0 else "✗"
        print(f"    [-{i+1}] {mark} {score:+.4f}  {snippet[:66]}...")


def main() -> None:
    total = len(POSITIVE_SNIPPETS) + len(NEGATIVE_SNIPPETS)
    print(f"Test set: {len(POSITIVE_SNIPPETS)} positive + {len(NEGATIVE_SNIPPETS)} negative snippets\n")

    results: list[ScorerResult] = []
    detail_scorers: list[tuple[str, BaseScorer]] = []

    print(f"  Loading NLI scorer ({NLI_MODEL})...")
    nli = NliScorer(NLI_MODEL, NLI_HYP_POS, NLI_HYP_NEG)
    results.append(evaluate(nli, "nli (tuned)"))
    detail_scorers.append(("nli (tuned)", nli))

    print(f"  Loading FinBERT scorer ({FINBERT_MODEL})...")
    finbert = FinbertScorer(FINBERT_MODEL)
    results.append(evaluate(finbert, "finbert"))
    detail_scorers.append(("finbert", finbert))

    # ── Summary table ──────────────────────────────────────────────────────
    print("\n" + "=" * 92)
    print(
        f"{'backend':<14} {'avg_pos':>9} {'avg_neg':>9} {'spread':>9} "
        f"{'max|s|':>9} {'polarity':>10} {'near0':>8}"
    )
    print("-" * 92)
    for r in results:
        polarity_str = f"{r.polarity_correct}/{r.polarity_total}"
        near_zero_str = f"{r.near_zero}/{total}"
        print(
            f"{r.name:<14} {r.avg_pos:>+9.4f} {r.avg_neg:>+9.4f} {r.spread:>9.4f} "
            f"{r.max_magnitude:>9.4f} {polarity_str:>10} {near_zero_str:>8}"
        )
    print("=" * 92)
    print("near0 = snippets with |score| < 0.05 (lower is less bimodal / more usable)")

    # ── Per-snippet detail for both backends ───────────────────────────────
    for name, scorer in detail_scorers:
        print_per_snippet(scorer, name)


if __name__ == "__main__":
    main()
