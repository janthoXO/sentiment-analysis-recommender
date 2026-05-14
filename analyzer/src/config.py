import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    rabbitmq_url: str
    mq_exchange: str
    mq_task_queue: str
    mq_result_routing_key: str
    model_name: str
    hypothesis_positive: str
    hypothesis_negative: str
    log_level: str
    prefetch_count: int


def load_config() -> Config:
    return Config(
        rabbitmq_url=os.getenv(
            "RABBITMQ_URL", "amqp://sentinel:sentinel@localhost:5672"
        ),
        mq_exchange=os.getenv("MQ_EXCHANGE", "sentinel.tasks"),
        mq_task_queue=os.getenv("MQ_TASK_QUEUE", "tasks.high"),
        mq_result_routing_key=os.getenv("MQ_RESULT_ROUTING_KEY", "result"),
        model_name=os.getenv("MODEL_NAME", "cross-encoder/nli-deberta-v3-base"),
        hypothesis_positive=os.getenv(
            "HYPOTHESIS_POSITIVE", "This is positive news for investors."
        ),
        hypothesis_negative=os.getenv(
            "HYPOTHESIS_NEGATIVE", "This is negative news for investors."
        ),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        prefetch_count=int(os.getenv("PREFETCH_COUNT", "1")),
    )
