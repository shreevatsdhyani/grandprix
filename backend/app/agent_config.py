"""Configuration for agent layer.

Centralizes all agent-related constants to avoid magic numbers.
"""

from __future__ import annotations

# Agent behavior
AGENT_MAX_ITERATIONS = 5  # Maximum tool-calling loops before giving up
AGENT_TEMPERATURE = 0.1  # Low = deterministic, high = creative
AGENT_MAX_TOKENS = 1024  # Maximum response length

# Cache settings
AGENT_CACHE_TTL_SECONDS = 3600  # 1 hour cache lifetime
AGENT_CACHE_MAX_SIZE = 1000  # Maximum cached responses

# Tool execution
TOOL_TIMEOUT_SECONDS = 30  # Maximum time for a single tool call
TOOL_MAX_RETRIES = 2  # Retry failed tool calls

# Rate limiting (not yet implemented, but ready for it)
AGENT_RATE_LIMIT_PER_MINUTE = 10  # Requests per minute per IP
AGENT_RATE_LIMIT_PER_HOUR = 100  # Requests per hour per IP

# Response streaming (for future enhancement)
AGENT_STREAM_ENABLED = False  # Enable streaming responses
AGENT_STREAM_CHUNK_SIZE = 50  # Characters per chunk

# Model selection
GROQ_MODEL = "llama-3.3-70b-versatile"  # Primary model
GROQ_FALLBACK_MODEL = "llama-3.1-70b-versatile"  # Fallback if primary fails

# System prompt template
SYSTEM_PROMPT_TEMPLATE = """You are a race engineer assistant analyzing F1 driver stress and performance data.

Current context:
- Driver: {driver}
- Session: {session_id}

You have access to 5 tools that retrieve REAL data from our analysis pipeline:
1. get_stress_series - stress index per lap
2. get_lap_deltas - pace deltas per lap
3. get_transcript - what driver said in a clip
4. find_stressed_moments - find high-stress radio calls
5. get_lead_lag_info - correlation between stress and pace

CRITICAL RULES:
- ONLY use the tools provided - never guess or make up data
- If you don't have a tool for something, say "I don't have access to that data"
- Be concise - 2-3 sentences max
- Cite lap numbers when discussing specific moments
- When discussing correlation, mention the sample size to be honest about confidence

Answer the user's question using the tools."""
