import json
import logging
from typing import Callable, Optional

import pika
from pika.adapters.blocking_connection import BlockingChannel

logger = logging.getLogger(__name__)

TaskHandler = Callable[[dict], Optional[dict]]


class MqClient:
    """Synchronous RabbitMQ client for the analyzer.

    Consumes `AnalyzerTask` messages from the task queue and publishes
    `AnalyzerResult` messages to the same exchange under the result
    routing key, mirroring the topology declared by the tracker.
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
        self.connection: Optional[pika.BlockingConnection] = None
        self.channel: Optional[BlockingChannel] = None

    def connect(self) -> None:
        params = pika.URLParameters(self.url)
        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()

        # Match the topology asserted by the tracker (mq.repo.ts) so
        # re-declarations are idempotent rather than a parameter clash.
        self.channel.exchange_declare(
            exchange=self.exchange, exchange_type="direct", durable=True
        )
        self.channel.queue_declare(
            queue=self.task_queue,
            durable=True,
            arguments={"x-max-priority": 10},
        )
        self.channel.queue_declare(queue="results", durable=True)
        self.channel.queue_bind(
            queue="results",
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
                result = handler(task)
            except Exception:
                logger.exception("Handler raised; dropping message")
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return

            if result is not None:
                self._publish_result(result)

            ch.basic_ack(delivery_tag=method.delivery_tag)

        self.channel.basic_consume(
            queue=self.task_queue, on_message_callback=callback
        )
        self.channel.start_consuming()

    def _publish_result(self, result: dict) -> None:
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
