"""Response caching for agent queries.

Caches agent responses to avoid expensive LLM calls for repeated questions.
Uses in-memory cache with TTL (time-to-live) eviction.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

log = logging.getLogger(__name__)


class AgentCache:
    """Simple in-memory cache for agent responses with TTL."""

    def __init__(self, ttl_seconds: int = 3600):
        """Initialize cache.

        Args:
            ttl_seconds: Time-to-live for cache entries (default 1 hour)
        """
        self._cache: dict[str, tuple[Any, float]] = {}
        self._ttl = ttl_seconds

    def _make_key(self, question: str, session_id: str, driver: str) -> str:
        """Generate cache key from query parameters."""
        data = f"{question.lower().strip()}:{session_id}:{driver}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]

    def get(self, question: str, session_id: str, driver: str) -> Any | None:
        """Get cached response if available and not expired."""
        key = self._make_key(question, session_id, driver)

        if key not in self._cache:
            return None

        response, timestamp = self._cache[key]

        # Check if expired
        if time.time() - timestamp > self._ttl:
            del self._cache[key]
            log.debug(f"Cache entry expired: {key}")
            return None

        log.info(f"Cache hit: {key}")
        return response

    def set(self, question: str, session_id: str, driver: str, response: Any) -> None:
        """Store response in cache."""
        key = self._make_key(question, session_id, driver)
        self._cache[key] = (response, time.time())
        log.debug(f"Cache set: {key}")

    def clear(self) -> None:
        """Clear all cache entries."""
        self._cache.clear()
        log.info("Cache cleared")

    def size(self) -> int:
        """Return number of cached entries."""
        return len(self._cache)

    def evict_expired(self) -> int:
        """Remove expired entries. Returns count of evicted entries."""
        now = time.time()
        expired = [
            key for key, (_, timestamp) in self._cache.items()
            if now - timestamp > self._ttl
        ]
        for key in expired:
            del self._cache[key]

        if expired:
            log.info(f"Evicted {len(expired)} expired cache entries")

        return len(expired)


# Global cache instance
_cache = AgentCache(ttl_seconds=3600)  # 1 hour TTL


def get_cache() -> AgentCache:
    """Get global cache instance."""
    return _cache
