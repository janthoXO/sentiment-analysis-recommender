import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


# Default model per scorer backend. Used when MODEL_NAME is not set, so that
# switching SCORER_TYPE alone picks a sensible model without extra config.
_DEFAULT_MODELS = {
    "nli": "cross-encoder/nli-deberta-v3-base",
    "finbert": "ProsusAI/finbert",
}


@dataclass(frozen=True)
class Config:
    rabbitmq_url: str
    mq_exchange: str
    mq_task_queue: str
    mq_result_routing_key: str
    scorer_type: str
    model_name: str
    hypothesis_positive: str
    hypothesis_negative: str
    log_level: str
    prefetch_count: int
    cache_ttl_seconds: int


def load_config() -> Config:
    scorer_type = os.getenv("SCORER_TYPE", "nli").strip().lower()
    # An explicit MODEL_NAME always wins; otherwise default to the model that
    # matches the selected backend.
    default_model = _DEFAULT_MODELS.get(scorer_type, _DEFAULT_MODELS["nli"])
    model_name = os.getenv("MODEL_NAME") or default_model

    return Config(
        rabbitmq_url=os.getenv(
            "RABBITMQ_URL", "amqp://sentinel:sentinel@localhost:5672"
        ),
        mq_exchange=os.getenv("MQ_EXCHANGE", "sentinel.analyze"),
        mq_task_queue=os.getenv("MQ_TASK_QUEUE", "tasks"),
        mq_result_routing_key=os.getenv("MQ_RESULT_ROUTING_KEY", "result"),
        scorer_type=scorer_type,
        model_name=model_name,
        hypothesis_positive=os.getenv(
            "HYPOTHESIS_POSITIVE", "The company's stock price will go up."
        ),
        hypothesis_negative=os.getenv(
            "HYPOTHESIS_NEGATIVE", "The company's stock price will go down."
        ),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        prefetch_count=int(os.getenv("PREFETCH_COUNT", "1")),
        cache_ttl_seconds=int(os.getenv("CACHE_TTL_SECONDS", "3600")),
    )
