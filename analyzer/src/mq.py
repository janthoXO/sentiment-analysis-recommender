import json
import logging
from typing import Callable

import pika
from pika.adapters.blocking_connection import BlockingChannel

logger = logging.getLogger(__name__)

# Handler receives a task dict and publishes its own per-article results.
# Return value is ignored (handler publishes inline).
TaskHandler = Callable[[dict], None]


class MqClient:
    """Synchronous RabbitMQ client for the analyzer.

    Consumes `AnalyzerTask` messages from the task queue and publishes one
    `AnalyzerResult` message *per article* to the results queue, mirroring the
    topology declared by core (mq.repo.ts).
    """

    def __init__(
        self,
        url: str,
        exchange: str,
        task_queue: str,
        result_routing_key: str,
        prefetch_count: int = 1,
    ) -> None:
        self.url = url
        self.exchange = exchange
        self.task_queue = task_queue
        self.result_routing_key = result_routing_key
        self.prefetch_count = prefetch_count
        self.connection = None
        self.channel: BlockingChannel | None = None

    def connect(self) -> None:
        params = pika.URLParameters(self.url)
        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()

        self.channel.exchange_declare(
            exchange=self.exchange, exchange_type="direct", durable=True
        )
        self.channel.queue_declare(
            queue=self.task_queue,
            durable=True,
            arguments={"x-max-priority": 10},
        )
        self.channel.queue_bind(
            queue=self.task_queue,
            exchange=self.exchange,
            routing_key=self.task_queue,
        )
        self.channel.queue_declare(queue=self.result_routing_key, durable=True)
        self.channel.queue_bind(
            queue=self.result_routing_key,
            exchange=self.exchange,
            routing_key=self.result_routing_key,
        )

        self.channel.basic_qos(prefetch_count=self.prefetch_count)
        logger.info(
            "Connected to RabbitMQ; consuming from queue '%s', publishing results to '%s'",
            self.task_queue,
            self.result_routing_key,
        )

    def consume(self, handler: TaskHandler) -> None:
        if self.channel is None:
            raise RuntimeError("MqClient.connect() must be called before consume()")

        def callback(ch, method, _properties, body):
            try:
                task = json.loads(body)
            except json.JSONDecodeError:
                logger.exception("Dropping invalid JSON message")
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return

            try:
                handler(task)
            except Exception:
                logger.exception("Handler raised; dropping message")
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return

            ch.basic_ack(delivery_tag=method.delivery_tag)

        self.channel.basic_consume(
            queue=self.task_queue, on_message_callback=callback
        )
        self.channel.start_consuming()

    def publish_result(self, result: dict) -> None:
        """Publish a single per-article AnalyzerResult."""
        if self.channel is None:
            raise RuntimeError("MqClient.connect() must be called before publishing")
        self.channel.basic_publish(
            exchange=self.exchange,
            routing_key=self.result_routing_key,
            body=json.dumps(result).encode("utf-8"),
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2,
            ),
        )

    def publish_results(self, results: list[dict]) -> None:
        """Publish one message per scored article."""
        for result in results:
            self.publish_result(result)

    def close(self) -> None:
        try:
            if self.channel and self.channel.is_open:
                self.channel.stop_consuming()
        except Exception:
            logger.exception("Error stopping consumer")
        try:
            if self.connection and self.connection.is_open:
                self.connection.close()
        except Exception:
            logger.exception("Error closing connection")
