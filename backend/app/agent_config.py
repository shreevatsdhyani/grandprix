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
#
# Groq retires models with little notice, and a retired model does not degrade —
# it 404s. This has now broken this app twice: `llama-3.1-70b-versatile` was set
# as a fallback and had already been removed, and `llama-3.3-70b-versatile` was
# the primary until it went the same way, taking the chat agent with it. Every
# Llama chat model is gone from the platform as of this writing.
#
# So the model is a *list*, tried in order, and the resolution is cached for the
# process. This is not belt-and-braces: it is the difference between a demo that
# survives an upstream retirement and one that shows a 503.
#
# Ordered by preference. All must support tool calling with `tool_choice` forcing
# and carry enough context for the findings block (~2-4k tokens of prompt).
GROQ_MODEL_CANDIDATES = [
    "openai/gpt-oss-120b",  # best available: 131k context, honours forced tool calls
    "openai/gpt-oss-20b",  # smaller sibling, identical interface
]
# Deliberately NOT candidates:
#   groq/compound, groq/compound-mini — agentic systems with built-in web search.
#     They would answer from the internet when our data is thin, which is exactly
#     the failure mode this app is built to avoid. A findings panel that quietly
#     sourced a lap time from a fan wiki would be worse than one that said nothing.
#   qwen/qwen3.6-27b — fails `tool_choice` forcing ("Failed to call a function"),
#     verified against the live API.

# Kept as the documented default and used when candidate resolution is bypassed.
GROQ_MODEL = GROQ_MODEL_CANDIDATES[0]

# Findings generation.
#
# `max_tokens` is bounded from BOTH sides, which is why it looks arbitrary:
#
#   too low  -> the tool call is truncated mid-JSON, and Groq reports that as an
#               opaque "Failed to parse tool call arguments" rather than a length
#               error, so it is expensive to diagnose
#   too high -> Groq counts prompt + max_tokens against the tokens-per-minute
#               quota BEFORE running anything, so a generous ceiling gets the
#               request rejected outright with a 413 even though the real output
#               would have fitted
#
# The free tier allows 8000 TPM. The context block runs ~2000-2500 tokens, so this
# leaves headroom on both sides. Raise it if you move to a paid tier; the retry
# ladder below covers the truncation case either way.
FINDINGS_MAX_TOKENS = 4000

# Groq's free tier allows 8000 tokens per minute, and it charges the request
# against that quota as `prompt + max_tokens` BEFORE running anything. So a
# generous ceiling is not free: it gets the whole request rejected with a 413 even
# when the real output would have been small. `findings.generate()` therefore sizes
# max_tokens from the actual prompt length rather than using a fixed number.
#
# Raise this if the account moves to a paid tier — nothing else needs to change.
GROQ_TPM_LIMIT = 8000
# Held back from the TPM budget to absorb tokeniser estimation error and the
# tool-schema overhead Groq counts but we cannot measure.
GROQ_TPM_MARGIN = 700
# Below this there is no point asking; the answer could not be a briefing.
FINDINGS_MIN_TOKENS = 1400

# The gpt-oss models spend part of the completion budget on hidden reasoning before
# emitting the tool call. "low" keeps that spend small, which matters when the
# whole budget is 8000 tokens a minute. The task is structured extraction over data
# we have already assembled and ranked-by-actionability judgement — not a problem
# that needs long deliberation.
FINDINGS_REASONING_EFFORT = "low"
FINDINGS_TEMPERATURE = 0.2
# How many findings to ask for. Above roughly eight the model starts padding with
# restatements of the same observation, which reads as thoroughness and is not.
FINDINGS_TARGET_COUNT = 6

# When the model still overruns the token budget, retry asking for fewer findings
# rather than failing. Each retry roughly halves the expected output length.
FINDINGS_RETRY_COUNTS = [4, 3]

# System prompt template
SYSTEM_PROMPT_TEMPLATE = """You are a race engineer assistant analysing F1 driver state and performance data.

Current context:
- Driver: {driver}
- Session: {session_id}

You have tools that retrieve REAL data from our analysis pipeline. Nothing else.

DRIVER STATE AND PACE
1. get_stress_series    - stress index per lap, derived from team radio voice
2. get_lap_deltas       - pace delta per lap vs the driver's own rolling median
3. get_transcript       - what the driver said in a given clip
4. find_stressed_moments- high-stress radio calls
5. get_lead_lag_info    - whether stress moved before or after pace

RACE CONTEXT
6. get_session_summary  - what data exists for this session; call this first if unsure
7. get_track_conditions - track/air temperature, rainfall, wind, grip proxy, wet/dry crossovers
8. get_tyre_state       - compound, tyre age, stint, MODELLED degradation
9. get_clip_context     - where on the lap a radio call happened: corner, speed, sector,
                          throttle/brake/gear/DRS, plus tyre, weather and race situation
10. get_race_situation  - position, gaps, traffic, flags, safety cars on a lap

CRITICAL RULES
- ONLY use the tools. Never guess, never fill a gap from general F1 knowledge.
- If no tool covers something, say "I don't have access to that data".
- A tool returning an "error" key means that data does not exist for that lap or clip.
  Say so; do not substitute a nearby lap without saying you did.

TYRE DATA — this one matters
Degradation figures are MODELLED from compound, tyre age and lap-time trend. No public
source has real F1 tyre temperature, pressure or wear; teams do not release it. Say "the
model suggests" or "lap times imply". Never state a tyre temperature or wear percentage.

RADIO PHASE
Radio marked pre_race or post_race happened on the grid or after the chequered flag. That
is not in-race stress — a driver shouting after winning scores as highly as one in trouble.
Check the phase before attributing a high reading to race conditions.

STYLE
- Concise: 2-4 sentences.
- Cite lap numbers, and corner numbers when you have them.
- When quoting a correlation, give the sample size.
- When a claim rests on only a few radio calls, say so.

Answer the user's question using the tools."""


# --------------------------------------------------------------------------
# Findings prompt
#
# The chat agent answers a question. This writes a briefing nobody asked for,
# which is a harder problem: with no question to anchor it, a language model will
# happily produce six confident restatements of the same chart.
#
# So the instructions push in three directions at once:
#   - rank by what an engineer would *do*, not by what sounds dramatic
#   - cite the numbers, because every claim gets checked against the timeline
#     afterwards and uncited ones cannot be verified
#   - say when the evidence is thin, because this dataset frequently has ~5 radio
#     calls for a driver and a confident claim off five points is noise
# --------------------------------------------------------------------------

FINDINGS_SYSTEM_PROMPT = """You are a Formula 1 performance analyst writing the driver-state section of a post-race debrief for a race engineer.

You will be given the complete data we hold for one driver in one session: their radio-derived stress readings, lap pace, tyre stints, track and weather evolution, where on the lap each radio call was made, and the race situation around it.

Write the {target_count} most useful findings.

WHAT MAKES A FINDING USEFUL
- It connects at least two domains. "Stress peaked on lap 41" is an observation. "Stress peaked on lap 41 while lapping backmarkers under blue flags on four-lap-old softs, and pace held" is a finding.
- It tells the engineer something they would act on, or explicitly tells them not to act. A finding that says "this looked bad and was actually fine" is valuable.
- It is specific. Lap numbers, corner numbers, temperatures, seconds.

RANK BY ACTIONABILITY, NOT DRAMA
Rank 1 is what you would tell the engineer first. A moderate problem they can fix outranks a dramatic one they cannot.

EVIDENCE RULES — these are enforced after you answer
- Every finding must cite the laps it is about in the `laps` field. Laps you cite are checked against the data; a finding citing a lap that is not in the data is discarded.
- Put the actual numbers in `evidence`, one string per number, e.g. "track temp fell 33.0C to 20.7C by lap 30" or "stress 89.8 on lap 41".
- Never state a number that is not in the data given to you. If you want to express a rate or a difference, compute it from numbers that are there and show your inputs.

TYRE LANGUAGE — important
Tyre degradation figures are MODELLED from compound, tyre age and lap-time trend. We have no tyre temperature, pressure or wear data; nobody outside a team does. Write "the model suggests", "consistent with", "lap times imply". Never write as though we measured the tyre.

HONESTY ABOUT SAMPLE SIZE
You will often have only a handful of radio calls for this driver. When a claim rests on fewer than about five readings, say so in the finding and set `confidence` at or below 0.5. Do not manufacture a pattern from two points.

PHASES
Radio marked pre_race or post_race happened on the grid or after the flag. Grid nerves and a victory shout are not mid-race fatigue — treat them as their own thing, and never fold them into a claim about race pace.

SEVERITY
"critical" = cost or nearly cost the race. "warning" = a real problem worth acting on. "info" = worth knowing, including reassuring findings.

Write for someone who knows F1. No preamble, no hedging filler, no restating the question."""
