# Analyzer

Stateless Python worker that consumes raw article snippets from RabbitMQ, scores their sentiment with an NLI model, and publishes the result back. Part of the sentiment-analysis-recommender pipeline (`tracker` -> `analyzer` -> `core`).

## Pipeline role

1. Consume `AnalyzerTask` messages from queue `tasks.high` (exchange `sentinel.tasks`, routing key `task.high`).
2. For each task, run the snippet through an NLI CrossEncoder against positive / negative hypotheses and compute a score in `[-1, +1]`.
3. Publish an `AnalyzerResult` to exchange `sentinel.tasks` with routing key `result` (consumed by `core` from the `results` queue).

Schemas live in [`../contracts/schemas/`](../contracts/schemas/).

## Local setup

```bash
cd analyzer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Make sure RabbitMQ is running (see root `docker-compose.yml`):

```bash
docker compose up -d rabbitmq
```

Run the worker:

```bash
python -m src.main
```

The first run downloads the NLI model (~700MB) into the local Hugging Face cache.

## Configuration

All settings come from environment variables (see `.env.example`). The model name and the positive/negative hypotheses are configurable so the team can swap the scoring approach without touching code.

## Reference notebook

`sentiment_nli.ipynb` (with `df_news.csv` / `df_metadata.csv`) is the original exploratory notebook the production scorer is derived from. Kept for reference and offline experiments — not used at runtime.
