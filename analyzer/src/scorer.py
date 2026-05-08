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
