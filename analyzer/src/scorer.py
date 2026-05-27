import logging

import numpy as np
import torch
from sentence_transformers import CrossEncoder

logger = logging.getLogger(__name__)


class BaseScorer:
    """Common interface for sentiment scorers.

    A scorer maps a piece of text to a sentiment score in [-1, +1], where
    +1 is maximally positive and -1 maximally negative. Backends differ in
    the model and method used, but all expose the same two methods so the
    rest of the analyzer is backend-agnostic.
    """

    def score(self, text: str) -> float:
        raise NotImplementedError

    def score_batch(self, texts: list[str]) -> list[float]:
        raise NotImplementedError


class NliScorer(BaseScorer):
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


class FinbertScorer(BaseScorer):
    """FinBERT-based sentiment scorer.

    FinBERT (e.g. ``ProsusAI/finbert``) is a sequence classifier fine-tuned
    on financial text. It outputs probabilities for positive / negative /
    neutral directly, so unlike the NLI scorer it needs no hypotheses.

    The [-1, +1] score is computed as ``P(positive) - P(negative)``, which
    ignores the neutral mass and naturally lands in range.
    """

    def __init__(self, model_name: str) -> None:
        # Imported lazily so the NLI path doesn't pay the import cost.
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
        )

        self.model_name = model_name
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("Loading FinBERT model %s on %s", model_name, self.device)

        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.to(self.device)
        self.model.eval()

        self.pos_idx, self.neg_idx = self._resolve_label_indices()
        logger.info(
            "FinBERT label indices: positive=%d negative=%d (labels=%s)",
            self.pos_idx,
            self.neg_idx,
            self._id2label(),
        )

    def _id2label(self) -> dict[int, str]:
        cfg = getattr(self.model.config, "id2label", None)
        if not cfg:
            # ProsusAI/finbert default ordering
            return {0: "positive", 1: "negative", 2: "neutral"}
        return {int(k): str(v) for k, v in cfg.items()}

    def _resolve_label_indices(self) -> tuple[int, int]:
        pos_idx, neg_idx = None, None
        for idx, label in self._id2label().items():
            low = label.lower()
            if "pos" in low:
                pos_idx = idx
            elif "neg" in low:
                neg_idx = idx
        if pos_idx is None or neg_idx is None:
            # Fall back to ProsusAI/finbert ordering
            return 0, 1
        return pos_idx, neg_idx

    def score(self, text: str) -> float:
        return self.score_batch([text])[0]

    def score_batch(self, texts: list[str]) -> list[float]:
        """Score multiple texts in a single FinBERT forward pass.

        Empty or whitespace-only texts receive a score of 0.0 and are excluded
        from the model call.
        """
        if not texts:
            return []

        valid_indices = [i for i, t in enumerate(texts) if t and t.strip()]
        scores = [0.0] * len(texts)

        if valid_indices:
            valid_texts = [texts[i] for i in valid_indices]
            inputs = self.tokenizer(
                valid_texts,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            ).to(self.device)

            with torch.no_grad():
                logits = self.model(**inputs).logits

            probs = torch.softmax(logits, dim=1).cpu().numpy()
            for batch_pos, text_idx in enumerate(valid_indices):
                pos = float(probs[batch_pos, self.pos_idx])
                neg = float(probs[batch_pos, self.neg_idx])
                scores[text_idx] = max(-1.0, min(1.0, pos - neg))

        return scores


def build_scorer(
    scorer_type: str,
    model_name: str,
    hypothesis_positive: str,
    hypothesis_negative: str,
) -> BaseScorer:
    """Factory: return the scorer backend selected by ``scorer_type``.

    - ``"nli"`` (default): hypothesis-based NLI scorer.
    - ``"finbert"``: FinBERT sequence classifier.
    """
    normalized = scorer_type.strip().lower()
    if normalized == "finbert":
        return FinbertScorer(model_name)
    if normalized != "nli":
        logger.warning(
            "Unknown SCORER_TYPE=%r; falling back to 'nli'", scorer_type
        )
    return NliScorer(model_name, hypothesis_positive, hypothesis_negative)
