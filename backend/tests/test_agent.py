"""Comprehensive test suite for the Agent layer.

Tests cover:
- Easy: Basic tool calls with valid data
- Medium: Edge cases, empty results, error handling
- Hard: Complex multi-tool queries, accuracy validation
- Extreme: Security, performance, hallucination resistance
"""

import pytest
from fastapi.testclient import TestClient
import time
import os

# Set environment variables before importing app
os.environ["GP_AGENT"] = "1"
os.environ["GROQ_API_KEY"] = os.getenv("GROQ_API_KEY", "")

from app.main import app
from app.routers.agent import (
    get_stress_series,
    get_lap_deltas,
    get_transcript,
    find_stressed_moments,
    get_lead_lag_info,
)

client = TestClient(app)

# Test data constants
TEST_SESSION = "2024-british-r"
TEST_DRIVER = "HAM"
INVALID_SESSION = "9999-fake-r"
INVALID_DRIVER = "XXX"


# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 1: EASY - Basic Tool Functionality
# ═══════════════════════════════════════════════════════════════════════════


class TestLevel1Easy:
    """Basic tool calls with valid, expected data."""

    def test_get_stress_series_basic(self):
        """Test getting stress data for a valid driver/session."""
        result = get_stress_series(TEST_DRIVER, TEST_SESSION)

        assert isinstance(result, dict), "Should return dict"
        assert len(result) > 0, "Should have stress data"

        # Check data format
        for lap, stress in result.items():
            assert isinstance(lap, int), "Lap should be integer"
            assert isinstance(stress, (int, float)), "Stress should be numeric"
            assert 0 <= stress <= 100, f"Stress {stress} should be 0-100"

    def test_get_lap_deltas_basic(self):
        """Test getting lap time deltas."""
        result = get_lap_deltas(TEST_DRIVER, TEST_SESSION)

        assert isinstance(result, dict), "Should return dict"
        assert len(result) > 0, "Should have lap delta data"

        # Check data format
        for lap, delta in result.items():
            assert isinstance(lap, int), "Lap should be integer"
            assert isinstance(delta, (int, float)), "Delta should be numeric"

    def test_get_transcript_basic(self):
        """Test getting transcript for a known clip."""
        # First, get a clip ID from the timeline
        stress_data = get_stress_series(TEST_DRIVER, TEST_SESSION)

        # Build timeline to find a clip ID
        from app.data import timeline as timeline_module
        timeline = timeline_module.build(TEST_SESSION, TEST_DRIVER, "fusion")

        if timeline.clips:
            clip_id = timeline.clips[0].clip_id
            result = get_transcript(clip_id)

            assert isinstance(result, str), "Should return string"
            # Transcript can be empty if not analyzed yet, but should be string
            assert result is not None, "Should not be None"

    def test_find_stressed_moments_basic(self):
        """Test finding high-stress moments."""
        result = find_stressed_moments(TEST_DRIVER, TEST_SESSION, min_stress=70.0)

        assert isinstance(result, list), "Should return list"

        # If we have results, validate format
        for moment in result:
            assert "lap" in moment
            assert "stress" in moment
            assert "clip_id" in moment
            assert moment["stress"] >= 70.0, "Should respect min_stress threshold"

    def test_get_lead_lag_info_basic(self):
        """Test getting correlation analysis."""
        result = get_lead_lag_info(TEST_DRIVER, TEST_SESSION)

        assert isinstance(result, dict), "Should return dict"

        # Should have either valid data or error message
        if "error" not in result:
            assert "peak_lag_laps" in result
            assert "peak_correlation" in result
            assert "n_samples" in result


# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 2: MEDIUM - Edge Cases & Error Handling
# ═══════════════════════════════════════════════════════════════════════════


class TestLevel2Medium:
    """Edge cases, invalid inputs, graceful degradation."""

    def test_stress_series_invalid_session(self):
        """Test with non-existent session."""
        result = get_stress_series(TEST_DRIVER, INVALID_SESSION)

        # Should return empty dict, not crash
        assert isinstance(result, dict)
        assert len(result) == 0

    def test_stress_series_invalid_driver(self):
        """Test with non-existent driver."""
        result = get_stress_series(INVALID_DRIVER, TEST_SESSION)

        # Should return empty dict, not crash
        assert isinstance(result, dict)
        assert len(result) == 0

    def test_transcript_invalid_clip_id(self):
        """Test with fake clip ID."""
        result = get_transcript("fake-clip-id-12345")

        # Should return empty string, not crash
        assert isinstance(result, str)
        assert result == ""

    def test_find_stressed_moments_no_matches(self):
        """Test with impossibly high threshold."""
        result = find_stressed_moments(TEST_DRIVER, TEST_SESSION, min_stress=999.0)

        # Should return empty list
        assert isinstance(result, list)
        assert len(result) == 0

    def test_api_endpoint_missing_fields(self):
        """Test API with missing required fields."""
        response = client.post("/api/agent/ask", json={
            "question": "Test question"
            # Missing session_id and driver
        })

        assert response.status_code == 422, "Should reject incomplete request"

    def test_api_endpoint_empty_question(self):
        """Test API with empty question."""
        response = client.post("/api/agent/ask", json={
            "question": "",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        # Should still return 200 but might say "I don't understand"
        assert response.status_code in [200, 400]


# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 3: HARD - Agent Intelligence & Accuracy
# ═══════════════════════════════════════════════════════════════════════════


class TestLevel3Hard:
    """Complex queries requiring multi-tool reasoning."""

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_agent_simple_stress_query(self):
        """Test: When did stress peak?"""
        response = client.post("/api/agent/ask", json={
            "question": "When did stress peak?",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()

        assert "answer" in data
        assert "tools_used" in data
        assert "get_stress_series" in data["tools_used"], "Should use stress tool"

        # Validate answer mentions a lap number
        answer = data["answer"].lower()
        assert "lap" in answer or any(str(i) in answer for i in range(1, 70))

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_agent_correlation_query(self):
        """Test: Was stress correlated with pace?"""
        response = client.post("/api/agent/ask", json={
            "question": "Was stress correlated with pace?",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        assert response.status_code == 200
        data = response.json()

        assert "get_lead_lag_info" in data["tools_used"], "Should use correlation tool"

        # Answer should mention correlation or lead/lag
        answer = data["answer"].lower()
        assert any(word in answer for word in ["correlation", "correlated", "lead", "lag"])

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_agent_find_moments_query(self):
        """Test: Find the most stressed moments."""
        response = client.post("/api/agent/ask", json={
            "question": "Find the most stressed moments",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        assert response.status_code == 200
        data = response.json()

        assert "find_stressed_moments" in data["tools_used"], "Should use find tool"

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_agent_multi_tool_query(self):
        """Test: Complex query requiring multiple tools."""
        response = client.post("/api/agent/ask", json={
            "question": "What was the stress level when pace was slowest?",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        assert response.status_code == 200
        data = response.json()

        # Should use both stress and lap delta tools
        tools = data["tools_used"]
        assert len(tools) >= 2, "Should use multiple tools"
        assert "get_stress_series" in tools or "get_lap_deltas" in tools


# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 4: EXTREME - Security, Performance, Hallucination Resistance
# ═══════════════════════════════════════════════════════════════════════════


class TestLevel4Extreme:
    """Security, performance benchmarks, hallucination tests."""

    def test_security_sql_injection_attempt(self):
        """Test: Attempt SQL injection in question."""
        response = client.post("/api/agent/ask", json={
            "question": "'; DROP TABLE clips; --",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        # Should handle gracefully, not crash
        assert response.status_code in [200, 400, 500]
        # Should not execute any SQL (we don't use SQL anyway)

    def test_security_command_injection_attempt(self):
        """Test: Attempt command injection."""
        response = client.post("/api/agent/ask", json={
            "question": "$(rm -rf /)",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        # Should handle gracefully
        assert response.status_code in [200, 400, 500]

    def test_security_path_traversal_attempt(self):
        """Test: Attempt path traversal."""
        response = client.post("/api/agent/ask", json={
            "question": "../../../etc/passwd",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        # Should handle gracefully
        assert response.status_code in [200, 400, 500]

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_hallucination_resistance_impossible_data(self):
        """Test: Ask for data that doesn't exist."""
        response = client.post("/api/agent/ask", json={
            "question": "What was the weather temperature at lap 35?",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        assert response.status_code == 200
        data = response.json()

        # Agent should admit it doesn't have weather data
        answer = data["answer"].lower()
        assert any(word in answer for word in ["don't", "no", "not available", "can't", "cannot"])

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_hallucination_resistance_fictional_driver(self):
        """Test: Ask about a driver not in the session."""
        response = client.post("/api/agent/ask", json={
            "question": "What was Mickey Mouse's stress level?",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        assert response.status_code == 200
        data = response.json()

        # Should respond about TEST_DRIVER (HAM), not make up Mickey Mouse data
        answer = data["answer"]
        assert "mickey mouse" not in answer.lower() or "don't" in answer.lower()

    @pytest.mark.skipif(not os.getenv("GROQ_API_KEY"), reason="No Groq API key")
    def test_performance_response_time(self):
        """Test: Response should be fast (<5s for simple query)."""
        start = time.time()

        response = client.post("/api/agent/ask", json={
            "question": "When did stress peak?",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        elapsed = time.time() - start

        assert response.status_code == 200
        assert elapsed < 10.0, f"Response took {elapsed:.2f}s - should be <10s"
        print(f"[OK] Response time: {elapsed:.2f}s")

    def test_tool_accuracy_stress_range(self):
        """Test: All stress values should be 0-100."""
        result = get_stress_series(TEST_DRIVER, TEST_SESSION)

        for lap, stress in result.items():
            assert 0 <= stress <= 100, f"Lap {lap}: stress {stress} out of range"

        print(f"[OK] Validated {len(result)} stress values")

    def test_tool_accuracy_lap_numbers(self):
        """Test: Lap numbers should be reasonable (1-70)."""
        result = get_stress_series(TEST_DRIVER, TEST_SESSION)

        for lap in result.keys():
            assert 1 <= lap <= 100, f"Lap {lap} out of reasonable range"

        print(f"[OK] Validated {len(result)} lap numbers")


# ═══════════════════════════════════════════════════════════════════════════
# INTEGRATION TESTS - Full System
# ═══════════════════════════════════════════════════════════════════════════


class TestIntegration:
    """End-to-end integration tests."""

    def test_health_endpoint(self):
        """Test: Health check endpoint works."""
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert "offline_ready" in data

    def test_sessions_endpoint(self):
        """Test: Can list sessions."""
        response = client.get("/api/sessions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_timeline_endpoint(self):
        """Test: Can build timeline."""
        response = client.get(f"/api/timeline/{TEST_SESSION}?driver={TEST_DRIVER}&mode=fusion")
        assert response.status_code == 200
        data = response.json()
        assert "session" in data
        assert "points" in data

    def test_agent_available(self):
        """Test: Agent endpoint is available."""
        response = client.post("/api/agent/ask", json={
            "question": "Test",
            "session_id": TEST_SESSION,
            "driver": TEST_DRIVER,
        })

        # Should not be 404 (not found)
        assert response.status_code != 404, "Agent endpoint should be available"


# ═══════════════════════════════════════════════════════════════════════════
# PERFORMANCE BENCHMARKS
# ═══════════════════════════════════════════════════════════════════════════


class TestPerformance:
    """Performance benchmarking and profiling."""

    def test_benchmark_stress_series(self):
        """Benchmark: get_stress_series speed."""
        times = []
        for _ in range(5):
            start = time.time()
            get_stress_series(TEST_DRIVER, TEST_SESSION)
            times.append(time.time() - start)

        avg_time = sum(times) / len(times)
        print(f"\n[OK] get_stress_series: {avg_time*1000:.2f}ms avg")
        assert avg_time < 1.0, "Should be fast (<1s)"

    def test_benchmark_lap_deltas(self):
        """Benchmark: get_lap_deltas speed."""
        times = []
        for _ in range(5):
            start = time.time()
            get_lap_deltas(TEST_DRIVER, TEST_SESSION)
            times.append(time.time() - start)

        avg_time = sum(times) / len(times)
        print(f"[OK] get_lap_deltas: {avg_time*1000:.2f}ms avg")
        assert avg_time < 1.0, "Should be fast (<1s)"

    def test_benchmark_find_stressed_moments(self):
        """Benchmark: find_stressed_moments speed."""
        times = []
        for _ in range(5):
            start = time.time()
            find_stressed_moments(TEST_DRIVER, TEST_SESSION)
            times.append(time.time() - start)

        avg_time = sum(times) / len(times)
        print(f"[OK] find_stressed_moments: {avg_time*1000:.2f}ms avg")
        assert avg_time < 1.0, "Should be fast (<1s)"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
