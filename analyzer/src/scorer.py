import logging

import numpy as np
import torch
from sentence_transformers import CrossEncoder

logger = logging.getLogger(__name__)


class SentimentScorer:
    """NLI-based sentiment scorer.

    For each input text, runs two NLI pairs against a positive and a
    negative hypothesis and returns `pos_entail - neg_entail`, a value in
    [-1, +1] suitable for the `AnalyzerResult.score` field.
    """

    def __init__(
        self,
        model_name: str,
        hypothesis_positive: str,
        hypothesis_negative: str,
    ) -> None:
        self.model_name = model_name
        self.h_pos = hypothesis_positive
        self.h_neg = hypothesis_negative

        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("Loading NLI model %s on %s", model_name, device)
        self.model = CrossEncoder(model_name, device=device)
        self.entail_idx = self._resolve_entailment_index()
        logger.info(
            "Entailment index resolved to %d (labels=%s)",
            self.entail_idx,
            self._id2label(),
        )

    def _id2label(self) -> dict[int, str]:
        cfg = getattr(self.model.model.config, "id2label", None)
        if not cfg:
            return {0: "CONTRADICTION", 1: "NEUTRAL", 2: "ENTAILMENT"}
        return {int(k): str(v) for k, v in cfg.items()}

    def _resolve_entailment_index(self) -> int:
        for idx, label in self._id2label().items():
            if "entail" in label.lower():
                return idx
        return 2

    def score(self, text: str) -> float:
        if not text or not text.strip():
            return 0.0

        pairs = [(text, self.h_pos), (text, self.h_neg)]
        probs = np.asarray(self.model.predict(pairs, apply_softmax=True))

        pos_entail = float(probs[0, self.entail_idx])
        neg_entail = float(probs[1, self.entail_idx])
        score = pos_entail - neg_entail

        return max(-1.0, min(1.0, score))

    def score_batch(self, texts: list[str]) -> list[float]:
        """Score multiple texts in a single NLI pass.

        Builds 2N pairs interleaved as [t0_pos, t0_neg, t1_pos, t1_neg, ...]
        and calls the model once, which is significantly faster than calling
        ``score()`` N times for large batches.

        Empty or whitespace-only texts receive a score of 0.0 and are excluded
        from the model call to avoid wasting compute.
        """
        if not texts:
            return []

        pairs: list[tuple[str, str]] = []
        # Track which indices in `texts` are non-empty so we can map results back
        valid_indices: list[int] = []

        for i, text in enumerate(texts):
            if text and text.strip():
                pairs.append((text, self.h_pos))
                pairs.append((text, self.h_neg))
                valid_indices.append(i)

        scores = [0.0] * len(texts)

        if pairs:
            probs = np.asarray(self.model.predict(pairs, apply_softmax=True))
            for batch_pos, text_idx in enumerate(valid_indices):
                pos_entail = float(probs[batch_pos * 2, self.entail_idx])
                neg_entail = float(probs[batch_pos * 2 + 1, self.entail_idx])
                scores[text_idx] = max(-1.0, min(1.0, pos_entail - neg_entail))

        return scores
