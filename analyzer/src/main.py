import logging
import signal
import sys
from typing import Optional

from .config import Config, load_config
from .mq import MqClient
from .scorer import SentimentScorer


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def _build_handler(scorer: SentimentScorer):
    log = logging.getLogger("analyzer.handler")

    def handle(task: dict) -> Optional[dict]:
        stock_id = task.get("stockId")
        snippet = task.get("snippet")
        url = task.get("url")

        if not stock_id or not snippet or not url:
            log.warning(
                "Skipping malformed task (missing required fields); keys=%s",
                list(task.keys()),
            )
            return None

        score = scorer.score(snippet)

        result: dict = {
            "stockId": stock_id,
            "score": score,
            "snippet": snippet,
            "url": url,
        }
        scan_job_id = task.get("scanJobId")
        if scan_job_id:
            result["scanJobId"] = scan_job_id

        log.info("Scored stockId=%s score=%.4f url=%s", stock_id, score, url)
        return result

    return handle


def main() -> None:
    cfg: Config = load_config()
    _setup_logging(cfg.log_level)
    log = logging.getLogger("analyzer.main")
    log.info("Starting analyzer (model=%s, queue=%s)", cfg.model_name, cfg.mq_task_queue)

    scorer = SentimentScorer(
        model_name=cfg.model_name,
        hypothesis_positive=cfg.hypothesis_positive,
        hypothesis_negative=cfg.hypothesis_negative,
    )
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
    handler = _build_handler(scorer)

    try:
        mq.consume(handler)
    except KeyboardInterrupt:
        log.info("Interrupted")
    finally:
        mq.close()


if __name__ == "__main__":
    main()
