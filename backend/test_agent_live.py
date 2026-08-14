"""Manual test script for agent intelligence.

Run this to test the agent's ability to answer questions correctly.
"""

import os
import requests
import time
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "http://localhost:8000"
TEST_SESSION = "2024-british-r"
TEST_DRIVER = "HAM"

# Color codes for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"


def test_agent_question(question: str, expected_keywords: list[str] = None, expected_tools: list[str] = None):
    """Test a single agent question."""
    print(f"\n{BLUE}Q: {question}{RESET}")

    start = time.time()
    response = requests.post(f"{BASE_URL}/api/agent/ask", json={
        "question": question,
        "session_id": TEST_SESSION,
        "driver": TEST_DRIVER,
    }, timeout=30)
    elapsed = time.time() - start

    if response.status_code != 200:
        print(f"{RED}[FAIL] HTTP {response.status_code} - {response.text}{RESET}")
        return False

    data = response.json()
    answer = data["answer"]
    tools = data["tools_used"]

    print(f"{GREEN}A: {answer}{RESET}")
    print(f"  Tools: {', '.join(tools)}")
    print(f"  Time: {elapsed:.2f}s")

    # Check expected tools
    if expected_tools:
        for tool in expected_tools:
            if tool not in tools:
                print(f"{YELLOW}  [WARNING] Expected tool '{tool}' not used{RESET}")

    # Check expected keywords in answer
    if expected_keywords:
        answer_lower = answer.lower()
        for keyword in expected_keywords:
            if keyword.lower() not in answer_lower:
                print(f"{YELLOW}  [WARNING] Expected keyword '{keyword}' not in answer{RESET}")

    return True


def main():
    print(f"{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}AGENT INTELLIGENCE TEST SUITE{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

    if not os.getenv("GROQ_API_KEY"):
        print(f"{RED}ERROR: GROQ_API_KEY not set in .env{RESET}")
        return

    # Check if backend is running
    try:
        health = requests.get(f"{BASE_URL}/api/health", timeout=5)
        if health.status_code != 200:
            print(f"{RED}ERROR: Backend not healthy{RESET}")
            return
    except Exception as e:
        print(f"{RED}ERROR: Backend not reachable: {e}{RESET}")
        print(f"{YELLOW}Start backend with: uvicorn app.main:app --reload{RESET}")
        return

    print(f"{GREEN}[OK] Backend healthy{RESET}")
    print(f"{GREEN}[OK] Testing driver: {TEST_DRIVER} in session: {TEST_SESSION}{RESET}")

    tests_passed = 0
    tests_total = 0

    # TEST 1: Simple stress query
    tests_total += 1
    if test_agent_question(
        "When did stress peak?",
        expected_keywords=["lap"],
        expected_tools=["get_stress_series"]
    ):
        tests_passed += 1

    # TEST 2: Correlation query
    tests_total += 1
    if test_agent_question(
        "Was stress correlated with pace?",
        expected_keywords=["correlation"],
        expected_tools=["get_lead_lag_info"]
    ):
        tests_passed += 1

    # TEST 3: Find moments query
    tests_total += 1
    if test_agent_question(
        "Find the most stressed moments",
        expected_tools=["find_stressed_moments"]
    ):
        tests_passed += 1

    # TEST 4: Multi-tool complex query
    tests_total += 1
    if test_agent_question(
        "What was the stress level when pace was slowest?",
        expected_tools=["get_stress_series", "get_lap_deltas"]
    ):
        tests_passed += 1

    # TEST 5: Hallucination resistance - impossible data
    tests_total += 1
    print(f"\n{BLUE}[HALLUCINATION TEST]{RESET}")
    if test_agent_question(
        "What was the weather temperature at lap 35?",
        expected_keywords=["don't", "not", "no", "can't", "cannot"]
    ):
        tests_passed += 1

    # TEST 6: Performance - should be fast
    tests_total += 1
    print(f"\n{BLUE}[PERFORMANCE TEST]{RESET}")
    start = time.time()
    response = requests.post(f"{BASE_URL}/api/agent/ask", json={
        "question": "When did stress peak?",
        "session_id": TEST_SESSION,
        "driver": TEST_DRIVER,
    }, timeout=30)
    elapsed = time.time() - start

    if response.status_code == 200 and elapsed < 10.0:
        print(f"{GREEN}[OK] Performance: {elapsed:.2f}s (< 10s target){RESET}")
        tests_passed += 1
    else:
        print(f"{RED}[FAIL] Performance: {elapsed:.2f}s (too slow or failed){RESET}")

    # SUMMARY
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

    percentage = (tests_passed / tests_total) * 100
    color = GREEN if percentage >= 80 else YELLOW if percentage >= 60 else RED

    print(f"\n{color}Passed: {tests_passed}/{tests_total} ({percentage:.1f}%){RESET}")

    if tests_passed == tests_total:
        print(f"{GREEN}[SUCCESS] ALL TESTS PASSED! Agent is working perfectly!{RESET}")
    elif tests_passed >= tests_total * 0.8:
        print(f"{YELLOW}[WARNING] Most tests passed, but some need attention{RESET}")
    else:
        print(f"{RED}[FAILED] Multiple failures detected{RESET}")


if __name__ == "__main__":
    main()
