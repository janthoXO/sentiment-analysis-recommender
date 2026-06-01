import logging
import signal
import sys

from .cache import AnalyzerCache
from .config import Config, load_config
from .mq import MqClient
from .scorer import BaseScorer, build_scorer


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def _build_handler(scorer: BaseScorer, cache: AnalyzerCache, mq: MqClient):
    log = logging.getLogger("analyzer.handler")

    def handle(task: dict) -> None:
        stock = task.get("stock")
        ticker = stock.get("ticker") if isinstance(stock, dict) else None
        job_id = task.get("jobId")
        sources = task.get("sources")

        if not ticker or not job_id or not isinstance(sources, list) or not sources:
            log.warning(
                "Skipping malformed task (missing required fields); keys=%s",
                list(task.keys()),
            )
            return

        # ── Layer 1: in-flight deduplication ──────────────────────────────
        # If another batch for the same ticker is already being processed,
        # try to resolve this batch entirely from the article cache.
        if cache.is_inflight(ticker):
            log.warning(
                "Ticker %s already in-flight; attempting full cache resolution "
                "for %d source(s)",
                ticker,
                len(sources),
            )
            all_cached = True
            for src in sources:
                score = cache.get(ticker, src.get("url", ""))
                if score is not None:
                    mq.publish_result({"ticker": ticker, "jobId": job_id, "source": {**src, "score": score}})
                else:
                    all_cached = False
                    break

            if all_cached:
                log.info(
                    "Skipped duplicate in-flight task for %s "
                    "(%d source(s) resolved from cache)",
                    ticker,
                    len(sources),
                )
                return
            # Otherwise fall through to normal scoring path

        # ── Layer 2: per-article TTL cache ─────────────────────────────────
        to_score_indices: list[int] = []

        for i, src in enumerate(sources):
            cached_score = cache.get(ticker, src.get("url", ""))
            if cached_score is not None:
                log.debug(
                    "Cache hit: ticker=%s url=%s score=%.4f",
                    ticker, src.get("url"), cached_score,
                )
                mq.publish_result({"ticker": ticker, "jobId": job_id, "source": {**src, "score": cached_score}})
            else:
                to_score_indices.append(i)

        if not to_score_indices:
            return

        # ── Inference for cache misses (batched for throughput) ────────────
        cache.mark_inflight(ticker)
        try:
            snippets = [
            f"{sources[i].get('title', '')}\n{sources[i].get('body', '')}".strip()
            for i in to_score_indices
        ]
            scores = scorer.score_batch(snippets)

            for i, score in zip(to_score_indices, scores):
                src = sources[i]
                url = src.get("url", "")
                cache.set(ticker, url, score)
                scored_src = {**src, "score": score}
                mq.publish_result({"ticker": ticker, "jobId": job_id, "source": scored_src})
                log.info("Scored ticker=%s score=%+.4f url=%s", ticker, score, url)
        finally:
            cache.unmark_inflight(ticker)

    return handle


def main() -> None:
    cfg: Config = load_config()
    _setup_logging(cfg.log_level)
    log = logging.getLogger("analyzer.main")
    log.info(
        "Starting analyzer (scorer=%s, model=%s, queue=%s, cache_ttl=%ds)",
        cfg.scorer_type,
        cfg.model_name,
        cfg.mq_task_queue,
        cfg.cache_ttl_seconds,
    )

    scorer = build_scorer(
        scorer_type=cfg.scorer_type,
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
    handler = _build_handler(scorer, cache, mq)

    try:
        mq.consume(handler)
    except KeyboardInterrupt:
        log.info("Interrupted")
    finally:
        mq.close()


if __name__ == "__main__":
    main()
