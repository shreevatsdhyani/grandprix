"""Tests for agent response caching.

Tests the AgentCache class used to speed up repeated queries.
"""

import time
import pytest
from app.routers.agent_cache import AgentCache


class TestAgentCacheBasics:
    """Basic cache functionality tests."""

    def test_cache_set_and_get(self):
        """Test basic set and get operations."""
        cache = AgentCache(ttl_seconds=60)

        response = {"answer": "Test answer", "tools_used": ["tool1"]}
        cache.set("What is stress?", "2024-british-r", "HAM", response)

        result = cache.get("What is stress?", "2024-british-r", "HAM")
        assert result == response

    def test_cache_miss(self):
        """Test cache miss returns None."""
        cache = AgentCache(ttl_seconds=60)

        result = cache.get("Unknown question", "session", "driver")
        assert result is None

    def test_cache_case_insensitive(self):
        """Test that questions are normalized (case-insensitive)."""
        cache = AgentCache(ttl_seconds=60)

        response = {"answer": "Test"}
        cache.set("WHAT IS STRESS?", "session", "driver", response)

        # Should hit cache with different case
        result = cache.get("what is stress?", "session", "driver")
        assert result == response

    def test_cache_whitespace_normalization(self):
        """Test that whitespace is normalized."""
        cache = AgentCache(ttl_seconds=60)

        response = {"answer": "Test"}
        cache.set("  What is stress?  ", "session", "driver", response)

        result = cache.get("What is stress?", "session", "driver")
        assert result == response


class TestCacheTTL:
    """Test time-to-live (expiration) logic."""

    def test_cache_expiration(self):
        """Test that cache entries expire after TTL."""
        cache = AgentCache(ttl_seconds=1)  # 1 second TTL

        response = {"answer": "Test"}
        cache.set("question", "session", "driver", response)

        # Should hit cache immediately
        assert cache.get("question", "session", "driver") == response

        # Wait for expiration
        time.sleep(1.1)

        # Should miss cache after expiration
        assert cache.get("question", "session", "driver") is None

    def test_cache_non_expiration(self):
        """Test that cache entries don't expire before TTL."""
        cache = AgentCache(ttl_seconds=60)

        response = {"answer": "Test"}
        cache.set("question", "session", "driver", response)

        # Should still be in cache
        assert cache.get("question", "session", "driver") == response


class TestCacheKeyGeneration:
    """Test cache key generation logic."""

    def test_different_questions_different_keys(self):
        """Test that different questions don't collide."""
        cache = AgentCache(ttl_seconds=60)

        cache.set("Question 1", "session", "driver", {"answer": "A"})
        cache.set("Question 2", "session", "driver", {"answer": "B"})

        assert cache.get("Question 1", "session", "driver")["answer"] == "A"
        assert cache.get("Question 2", "session", "driver")["answer"] == "B"

    def test_different_sessions_different_keys(self):
        """Test that same question for different sessions don't collide."""
        cache = AgentCache(ttl_seconds=60)

        cache.set("What is stress?", "session1", "driver", {"answer": "A"})
        cache.set("What is stress?", "session2", "driver", {"answer": "B"})

        assert cache.get("What is stress?", "session1", "driver")["answer"] == "A"
        assert cache.get("What is stress?", "session2", "driver")["answer"] == "B"

    def test_different_drivers_different_keys(self):
        """Test that same question for different drivers don't collide."""
        cache = AgentCache(ttl_seconds=60)

        cache.set("What is stress?", "session", "HAM", {"answer": "A"})
        cache.set("What is stress?", "session", "VER", {"answer": "B"})

        assert cache.get("What is stress?", "session", "HAM")["answer"] == "A"
        assert cache.get("What is stress?", "session", "VER")["answer"] == "B"


class TestCacheManagement:
    """Test cache management operations."""

    def test_cache_clear(self):
        """Test clearing the cache."""
        cache = AgentCache(ttl_seconds=60)

        cache.set("q1", "s", "d", {"a": "1"})
        cache.set("q2", "s", "d", {"a": "2"})

        assert cache.size() == 2

        cache.clear()

        assert cache.size() == 0
        assert cache.get("q1", "s", "d") is None
        assert cache.get("q2", "s", "d") is None

    def test_cache_size(self):
        """Test cache size tracking."""
        cache = AgentCache(ttl_seconds=60)

        assert cache.size() == 0

        cache.set("q1", "s", "d", {"a": "1"})
        assert cache.size() == 1

        cache.set("q2", "s", "d", {"a": "2"})
        assert cache.size() == 2

    def test_evict_expired(self):
        """Test manual eviction of expired entries."""
        cache = AgentCache(ttl_seconds=1)

        cache.set("q1", "s", "d", {"a": "1"})
        cache.set("q2", "s", "d", {"a": "2"})

        assert cache.size() == 2

        # Wait for expiration
        time.sleep(1.1)

        # Manually evict
        evicted = cache.evict_expired()

        assert evicted == 2
        assert cache.size() == 0

    def test_evict_partial(self):
        """Test evicting only expired entries."""
        cache = AgentCache(ttl_seconds=2)

        # Set first entry
        cache.set("q1", "s", "d", {"a": "1"})

        # Wait 1 second
        time.sleep(1.1)

        # Set second entry (should not expire)
        cache.set("q2", "s", "d", {"a": "2"})

        # Wait for first to expire
        time.sleep(1.1)

        # Evict expired
        evicted = cache.evict_expired()

        assert evicted == 1
        assert cache.size() == 1
        assert cache.get("q2", "s", "d") is not None


class TestCacheIntegration:
    """Test cache behavior with realistic scenarios."""

    def test_cache_hit_performance(self):
        """Test that cache hits are fast."""
        cache = AgentCache(ttl_seconds=60)

        large_response = {"answer": "x" * 1000, "tools_used": ["tool"] * 100}
        cache.set("question", "session", "driver", large_response)

        # Time cache hit
        start = time.time()
        for _ in range(100):
            cache.get("question", "session", "driver")
        elapsed = time.time() - start

        # 100 cache hits should take < 10ms
        assert elapsed < 0.01, f"Cache hits too slow: {elapsed}s"

    def test_cache_multiple_sessions(self):
        """Test cache with multiple sessions."""
        cache = AgentCache(ttl_seconds=60)

        sessions = ["2024-british-r", "2024-monaco-r", "2024-silverstone-r"]
        drivers = ["HAM", "VER", "LEC"]

        # Populate cache
        for session in sessions:
            for driver in drivers:
                cache.set("What is stress?", session, driver, {
                    "answer": f"{session}-{driver}",
                    "tools_used": []
                })

        # Verify all entries
        for session in sessions:
            for driver in drivers:
                result = cache.get("What is stress?", session, driver)
                assert result["answer"] == f"{session}-{driver}"

        assert cache.size() == len(sessions) * len(drivers)
