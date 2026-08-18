"""Ask the Pit Wall — agentic Q&A over race data.

Feature-flagged behind GP_AGENT=1. Uses Groq (free, fast) with tool calling to
answer natural-language questions about driver stress, lap performance, and
radio transcripts.

The agent has NO access to filesystem, database, or external APIs. It can ONLY
call the 5 tools defined here, which wrap our existing data layer — so every
number it cites comes from data/results/, the same source the UI reads.

Zero hallucination risk: if the agent doesn't have a tool for something, it
says "I don't have access to that data" rather than making up an answer.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import agent_config, config
from app.data import store, timeline as timeline_module
from app.schemas import ScoringMode
from app.routers.agent_cache import get_cache

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent", tags=["agent"])


class AgentRequest(BaseModel):
    question: str
    session_id: str
    driver: str


class AgentResponse(BaseModel):
    answer: str
    tools_used: list[str]


# ═══════════════════════════════════════════════════════════════════════════
# TOOLS — These are the ONLY functions the agent can call
# ═══════════════════════════════════════════════════════════════════════════


def _mode(name: str) -> ScoringMode:
    """The model picked this string, so it may be anything.

    An unrecognised mode falls back to fusion rather than raising: the question
    was about stress, not about scoring paths, and answering it from the
    dashboard's own mode beats a tool error the agent has to apologise for.
    """
    try:
        return ScoringMode(name)
    except ValueError:
        log.warning(f"Agent asked for unknown scoring mode {name!r} — using fusion")
        return ScoringMode.FUSION


def get_stress_series(driver: str, session_id: str, mode: str = "fusion") -> dict[int, float]:
    """Get stress index (0-100) per lap for a driver in a session.

    Returns a dict mapping lap number to stress index, e.g.:
    {35: 78.2, 36: 82.1, 37: 75.3}
    """
    try:
        timeline = timeline_module.build(session_id, driver, _mode(mode))
        return {
            p.lap: round(p.stress_index, 1)
            for p in timeline.points
            if p.stress_index is not None
        }
    except Exception as e:
        log.error(f"get_stress_series failed: {e}")
        return {}


def get_lap_deltas(driver: str, session_id: str) -> dict[int, float]:
    """Get pace delta (seconds vs rolling median) per lap for a driver.

    Positive = slower than usual, negative = faster than usual.
    Returns: {lap: delta_s, ...}
    """
    try:
        timeline = timeline_module.build(session_id, driver, ScoringMode.FUSION)
        return {
            p.lap: round(p.delta_s, 3)
            for p in timeline.points
            if p.delta_s is not None
        }
    except Exception as e:
        log.error(f"get_lap_deltas failed: {e}")
        return {}


def get_transcript(clip_id: str) -> str:
    """Get what the driver said in a specific radio call.

    Returns the transcript text, or empty string if clip not found.
    """
    try:
        analysis = store.get_cached(clip_id)
        if analysis:
            return analysis.transcript.text
        return ""
    except Exception as e:
        log.error(f"get_transcript failed: {e}")
        return ""


def find_stressed_moments(driver: str, session_id: str, min_stress: float = 70.0) -> list[dict]:
    """Find radio calls where stress exceeded a threshold.

    Returns list of {lap, stress, clip_id, mood} for moments above min_stress.
    """
    try:
        timeline = timeline_module.build(session_id, driver, ScoringMode.FUSION)
        moments = []
        for p in timeline.points:
            if p.stress_index and p.stress_index >= min_stress and p.clip_id:
                moments.append({
                    "lap": p.lap,
                    "stress": round(p.stress_index, 1),
                    "clip_id": p.clip_id,
                    "mood": str(p.mood) if p.mood else None,
                })
        return moments
    except Exception as e:
        log.error(f"find_stressed_moments failed: {e}")
        return []


def get_lead_lag_info(driver: str, session_id: str) -> dict[str, Any]:
    """Get lead-lag correlation analysis between stress and pace.

    Returns peak correlation lag, correlation coefficient, and sample size.
    """
    try:
        timeline = timeline_module.build(session_id, driver, ScoringMode.FUSION)
        if not timeline.lead_lag:
            return {"error": "Not enough data for lead-lag analysis"}

        return {
            "peak_lag_laps": timeline.lead_lag.peak_lag_laps,
            "peak_correlation": round(timeline.lead_lag.peak_correlation, 3),
            "n_samples": timeline.lead_lag.n_samples,
            "interpretation": timeline.lead_lag.interpretation,
            "is_significant": timeline.lead_lag.is_significant,
        }
    except Exception as e:
        log.error(f"get_lead_lag_info failed: {e}")
        return {"error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
# TOOL DEFINITIONS for Groq
# ═══════════════════════════════════════════════════════════════════════════

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_stress_series",
            "description": "Get stress index (0-100) per lap for a specific driver in a race session. Use this when asked about stress levels, when stress peaked, or stress patterns over the race.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {
                        "type": "string",
                        "description": "3-letter driver code (e.g. HAM, VER, LEC)",
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Session identifier like '2024-british-r'",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["fusion", "naive"],
                        "description": "Scoring mode - 'fusion' (default) or 'naive'",
                    },
                },
                "required": ["driver", "session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_lap_deltas",
            "description": "Get lap time delta (seconds vs rolling median baseline) per lap. Positive values = slower than usual, negative = faster. Use when asked about pace, lap times, or performance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {"type": "string", "description": "3-letter driver code"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                },
                "required": ["driver", "session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_transcript",
            "description": "Get the transcript of what a driver said in a specific radio call. Use when asked about what the driver said, or the content of a specific clip.",
            "parameters": {
                "type": "object",
                "properties": {
                    "clip_id": {
                        "type": "string",
                        "description": "Clip identifier (e.g. '2024-british-r-HAM-160752')",
                    },
                },
                "required": ["clip_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_stressed_moments",
            "description": "Find all radio calls where stress exceeded a threshold. Returns clip IDs, lap numbers, stress levels, and mood labels. Use when asked to find high stress moments or elevated stress periods.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {"type": "string", "description": "3-letter driver code"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                    "min_stress": {
                        "type": "number",
                        "description": "Minimum stress threshold (default 70.0)",
                        "default": 70.0,
                    },
                },
                "required": ["driver", "session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_lead_lag_info",
            "description": "Get lead-lag correlation analysis showing if stress changes preceded or followed pace changes. Returns peak lag (negative = stress led pace), correlation coefficient, and sample size.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {"type": "string", "description": "3-letter driver code"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                },
                "required": ["driver", "session_id"],
            },
        },
    },
]


# Map tool names to actual Python functions
TOOL_MAP = {
    "get_stress_series": get_stress_series,
    "get_lap_deltas": get_lap_deltas,
    "get_transcript": get_transcript,
    "find_stressed_moments": find_stressed_moments,
    "get_lead_lag_info": get_lead_lag_info,
}


# ═══════════════════════════════════════════════════════════════════════════
# AGENT LOOP
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/ask", response_model=AgentResponse)
async def ask_agent(req: AgentRequest) -> AgentResponse:
    """Ask a natural-language question about race data.

    The agent can call tools to retrieve stress data, lap times, transcripts,
    and correlation analysis. Every answer is grounded in real data from
    data/results/ — no hallucination.

    Responses are cached for 1 hour to improve performance.
    """
    # Input validation
    if not req.question or not req.question.strip():
        raise HTTPException(400, "Question cannot be empty")

    # Check cache first
    cache = get_cache()
    cached = cache.get(req.question, req.session_id, req.driver)
    if cached is not None:
        log.info(f"Returning cached response for: {req.question[:50]}...")
        return AgentResponse(**cached)

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(500, "GROQ_API_KEY not set")

    try:
        from groq import Groq
    except ImportError:
        raise HTTPException(500, "Groq SDK not installed - run: pip install groq")

    client = Groq(api_key=api_key)

    # System prompt that prevents hallucination
    system_prompt = agent_config.SYSTEM_PROMPT_TEMPLATE.format(
        driver=req.driver,
        session_id=req.session_id
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.question},
    ]

    tools_used = []

    # Try the primary model, then the fallback. Groq retires hosted models on
    # notice and a retired name comes back as a 404, so a single hardcoded model
    # is a scheduled outage: this endpoint was already dead that way. Sticky per
    # request rather than per call — switching models mid-conversation would hand
    # a second model someone else's half-finished tool loop.
    model = agent_config.GROQ_MODEL

    for iteration in range(agent_config.AGENT_MAX_ITERATIONS):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                max_tokens=agent_config.AGENT_MAX_TOKENS,
                temperature=agent_config.AGENT_TEMPERATURE,
            )
        except Exception as e:
            fallback = agent_config.GROQ_FALLBACK_MODEL
            if model == fallback:
                log.error(f"Groq API call failed on {model}: {e}")
                raise HTTPException(500, f"Agent failed: {str(e)}")
            log.warning(f"Groq model {model} failed ({e}) — retrying on {fallback}")
            model = fallback
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    max_tokens=agent_config.AGENT_MAX_TOKENS,
                    temperature=agent_config.AGENT_TEMPERATURE,
                )
            except Exception as e2:
                log.error(f"Groq API call failed on fallback {model}: {e2}")
                raise HTTPException(500, f"Agent failed: {str(e2)}")

        assistant_message = response.choices[0].message

        # If no tool calls, we have the final answer
        if not assistant_message.tool_calls:
            final_answer = (assistant_message.content or "").strip()
            # A turn that is all reasoning and no prose is not an answer. These
            # models put their working in a separate `reasoning` field and
            # occasionally stop there, and the old code shipped the placeholder
            # to the user *and cached it for an hour* — so one empty turn made
            # that question permanently unanswerable. Ask again instead; the
            # tool results are still in `messages`, so it costs one round trip
            # and the loop's own iteration cap bounds it.
            if not final_answer:
                log.warning(f"{model} returned no prose on iteration {iteration} — re-prompting")
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Answer now, in prose, using only the tool results above."
                        ),
                    }
                )
                continue

            response = AgentResponse(answer=final_answer, tools_used=tools_used)

            # Cache the response
            cache.set(req.question, req.session_id, req.driver, response.model_dump())

            return response

        # Execute tool calls
        messages.append({
            "role": "assistant",
            "content": assistant_message.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in assistant_message.tool_calls
            ],
        })

        for tool_call in assistant_message.tool_calls:
            func_name = tool_call.function.name
            tools_used.append(func_name)

            try:
                # Parse arguments and call the function
                args = json.loads(tool_call.function.arguments)
                func = TOOL_MAP.get(func_name)

                if not func:
                    result = {"error": f"Unknown tool: {func_name}"}
                else:
                    result = func(**args)

                # Send result back to the agent
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })
            except Exception as e:
                log.error(f"Tool {func_name} failed: {e}")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps({"error": str(e)}),
                })

    # Max iterations reached. Deliberately not cached: this is a failure of the
    # loop, not a property of the question, and an hour of serving it instantly
    # would make a transient stall look like a permanent refusal.
    return AgentResponse(
        answer="I couldn't complete the analysis - too many steps required.",
        tools_used=tools_used,
    )
