import logging
import threading
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class _Entry:
    score: float
    expires_at: float  # monotonic timestamp


class AnalyzerCache:
    """Two-layer deduplication cache for the analyzer worker.

    Layer 1 — in-flight map
        Tracks which tickers are currently being scored by this worker
        process.  If a second batch for the same ticker arrives while the
        first is still in-flight (possible when prefetch_count > 1 or with
        multiple worker containers), the handler can detect the collision
        and short-circuit using layer-2 results instead of running the NLI
        model again.

    Layer 2 — per-article TTL cache
        Stores scored results keyed by ``(ticker, url)`` for
        ``ttl_seconds``.  Prevents re-running NLI inference on an article
        that was already scored within the TTL window — relevant both for
        the background prefetch loop (which rescans tickers every 6 h) and
        for duplicate user searches.

    Thread-safety
        All state is protected by a single ``threading.RLock``.  The lock
        is cheap relative to NLI inference; using RLock (reentrant) lets
        helper methods call each other without deadlocking if we ever
        refactor.

    Note on horizontal scale
        Both layers are in-process.  For multi-container deployments a
        shared Redis store would be needed to deduplicate *across* workers.
        The per-article cache in ``core/src/02analyzer/score.cache.ts``
        already provides that layer; this cache reduces redundant NLI work
        *within* a single worker.
    """

    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._ttl = ttl_seconds
        self._lock = threading.RLock()
        self._inflight: set[str] = set()
        self._cache: dict[tuple[str, str], _Entry] = {}

    # ── Layer 1: in-flight map ─────────────────────────────────────────────

    def is_inflight(self, ticker: str) -> bool:
        """Return True if a batch for *ticker* is currently being scored."""
        with self._lock:
            return ticker in self._inflight

    def mark_inflight(self, ticker: str) -> None:
        with self._lock:
            self._inflight.add(ticker)

    def unmark_inflight(self, ticker: str) -> None:
        with self._lock:
            self._inflight.discard(ticker)

    # ── Layer 2: article score cache ───────────────────────────────────────

    def get(self, ticker: str, url: str) -> float | None:
        """Return the cached score for *(ticker, url)*, or ``None`` if
        absent or expired (lazy eviction on read)."""
        key = (ticker, url)
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if time.monotonic() > entry.expires_at:
                del self._cache[key]
                return None
            return entry.score

    def set(self, ticker: str, url: str, score: float) -> None:
        """Store *score* for *(ticker, url)* with the configured TTL."""
        key = (ticker, url)
        with self._lock:
            self._cache[key] = _Entry(
                score=score,
                expires_at=time.monotonic() + self._ttl,
            )

    def evict_expired(self) -> int:
        """Eagerly remove all expired entries.

        Not required for correctness (``get`` evicts lazily), but useful
        to call periodically to keep memory bounded in long-running workers.
        Returns the number of entries removed.
        """
        now = time.monotonic()
        with self._lock:
            expired = [k for k, v in self._cache.items() if v.expires_at <= now]
            for k in expired:
                del self._cache[k]
        if expired:
            logger.debug("Evicted %d expired cache entries", len(expired))
        return len(expired)
