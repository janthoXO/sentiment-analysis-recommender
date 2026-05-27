import logging
import signal
import sys
from typing import Optional

from .cache import AnalyzerCache
from .config import Config, load_config
from .mq import MqClient
from .scorer import SentimentScorer


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def _build_handler(scorer: SentimentScorer, cache: AnalyzerCache):
    log = logging.getLogger("analyzer.handler")

    def handle(task: dict) -> Optional[dict]:
        ticker = task.get("ticker")
        job_id = task.get("jobId")
        sources = task.get("sources")

        if not ticker or not job_id or not isinstance(sources, list) or not sources:
            log.warning(
                "Skipping malformed task (missing required fields); keys=%s",
                list(task.keys()),
            )
            return None

        # ── Layer 1: in-flight deduplication ──────────────────────────────
        # If another batch for the same ticker is already being processed
        # (e.g. two workers pulled the same ticker, or prefetch_count > 1),
        # try to resolve this batch entirely from the article cache so we
        # don't run duplicate NLI inference.
        if cache.is_inflight(ticker):
            log.warning(
                "Ticker %s already in-flight; attempting full cache resolution "
                "for %d source(s)",
                ticker,
                len(sources),
            )
            cached_sources = []
            for src in sources:
                score = cache.get(ticker, src.get("url", ""))
                if score is not None:
                    cached_sources.append({**src, "score": score})
                else:
                    break  # at least one source is missing — fall through
            else:
                # All sources resolved from cache: skip NLI entirely
                log.info(
                    "Skipped duplicate in-flight task for %s "
                    "(%d source(s) resolved from cache)",
                    ticker,
                    len(cached_sources),
                )
                return {"ticker": ticker, "jobId": job_id, "sources": cached_sources}

        # ── Layer 2: per-article TTL cache ─────────────────────────────────
        # Split sources into cache hits (no NLI needed) and misses (need scoring).
        result_sources: list[Optional[dict]] = [None] * len(sources)
        to_score_indices: list[int] = []

        for i, src in enumerate(sources):
            cached_score = cache.get(ticker, src.get("url", ""))
            if cached_score is not None:
                result_sources[i] = {**src, "score": cached_score}
                log.debug(
                    "Cache hit: ticker=%s url=%s score=%.4f",
                    ticker, src.get("url"), cached_score,
                )
            else:
                to_score_indices.append(i)

        # ── NLI inference for cache misses ─────────────────────────────────
        cache.mark_inflight(ticker)
        try:
            if to_score_indices:
                snippets = [sources[i].get("snippet", "") for i in to_score_indices]
                scores = scorer.score_batch(snippets)

                for i, score in zip(to_score_indices, scores):
                    src = sources[i]
                    url = src.get("url", "")
                    cache.set(ticker, url, score)
                    result_sources[i] = {**src, "score": score}
                    log.info(
                        "Scored ticker=%s score=%+.4f url=%s", ticker, score, url
                    )
        finally:
            cache.unmark_inflight(ticker)

        return {"ticker": ticker, "jobId": job_id, "sources": result_sources}

    return handle


def main() -> None:
    cfg: Config = load_config()
    _setup_logging(cfg.log_level)
    log = logging.getLogger("analyzer.main")
    log.info(
        "Starting analyzer (model=%s, queue=%s, cache_ttl=%ds)",
        cfg.model_name,
        cfg.mq_task_queue,
        cfg.cache_ttl_seconds,
    )

    scorer = SentimentScorer(
        model_name=cfg.model_name,
        hypothesis_positive=cfg.hypothesis_positive,
        hypothesis_negative=cfg.hypothesis_negative,
    )
    cache = AnalyzerCache(ttl_seconds=cfg.cache_ttl_seconds)
    mq = MqClient(
        url=cfg.rabbitmq_url,
        exchange=cfg.mq_exchange,
        task_queue=cfg.mq_task_queue,
        result_routing_key=cfg.mq_result_routing_key,
        prefetch_count=cfg.prefetch_count,
    )

    def shutdown(signum, _frame):
        log.info("Received signal %d, shutting down", signum)
        mq.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    mq.connect()
    handler = _build_handler(scorer, cache)

    try:
        mq.consume(handler)
    except KeyboardInterrupt:
        log.info("Interrupted")
    finally:
        mq.close()


if __name__ == "__main__":
    main()
