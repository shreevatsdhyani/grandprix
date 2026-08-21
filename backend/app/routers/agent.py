"""Ask the Pit Wall — agentic Q&A over race data.

Feature-flagged behind GP_AGENT=1. Uses Groq (free, fast) with tool calling to
answer natural-language questions about driver stress, lap performance, and
radio transcripts.

The agent has NO access to filesystem, database, or external APIs. It can ONLY
call the tools defined here, which wrap our existing data layer — so every
number it cites comes from data/results/ and data/context/, the same sources the
UI reads.

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

import functools

from app import agent_config, config, groq_client
from app.data import store, timeline as timeline_module
from app.routers.agent_cache import get_cache
from app.schemas import ScoringMode


# Every tool below needs a timeline, and a single question routinely triggers
# three or four tool calls. Each `timeline_module.build()` re-reads the FastF1 lap
# cache, re-parses every clip result and re-runs the lead-lag correlation, so an
# unmemoised turn did that work four times over — and now also re-reads the
# context file each time. Memoised per process, which is safe because the inputs
# are files written offline by build scripts, not live state.
#
# `maxsize` covers a demo's worth of session/driver/mode combinations. Cleared by
# `_invalidate_timelines()` if a rebuild happens while the server is up.
@functools.lru_cache(maxsize=64)
def _timeline(session_id: str, driver: str, mode: str):
    return timeline_module.build(session_id, driver.upper(), ScoringMode(mode))


def _invalidate_timelines() -> None:
    _timeline.cache_clear()

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


def get_stress_series(driver: str, session_id: str, mode: str = "fusion") -> dict[int, float]:
    """Get stress index (0-100) per lap for a driver in a session.

    Returns a dict mapping lap number to stress index, e.g.:
    {35: 78.2, 36: 82.1, 37: 75.3}
    """
    log.debug(f"[TOOL:get_stress_series] Called with driver={driver}, session={session_id}, mode={mode}")
    try:
        timeline = _timeline(session_id, driver, mode)
        result = {
            p.lap: round(p.stress_index, 1)
            for p in timeline.points
            if p.stress_index is not None
        }
        log.debug(f"[TOOL:get_stress_series] Returning {len(result)} stress readings")
        return result
    except Exception as e:
        log.error(f"[TOOL:get_stress_series] Failed: {e}", exc_info=True)
        return {}


def get_lap_deltas(driver: str, session_id: str) -> dict[int, float]:
    """Get pace delta (seconds vs rolling median) per lap for a driver.

    Positive = slower than usual, negative = faster than usual.
    Returns: {lap: delta_s, ...}
    """
    log.debug(f"[TOOL:get_lap_deltas] Called with driver={driver}, session={session_id}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        result = {
            p.lap: round(p.delta_s, 3)
            for p in timeline.points
            if p.delta_s is not None
        }
        log.debug(f"[TOOL:get_lap_deltas] Returning {len(result)} lap deltas")
        return result
    except Exception as e:
        log.error(f"[TOOL:get_lap_deltas] Failed: {e}", exc_info=True)
        return {}


def get_transcript(clip_id: str) -> str:
    """Get what the driver said in a specific radio call.

    Returns the transcript text, or empty string if clip not found.
    """
    log.debug(f"[TOOL:get_transcript] Called with clip_id={clip_id}")
    try:
        analysis = store.get_cached(clip_id)
        if analysis:
            transcript = analysis.transcript.text
            log.debug(f"[TOOL:get_transcript] Found transcript ({len(transcript)} chars): {transcript[:100]}...")
            return transcript
        log.debug(f"[TOOL:get_transcript] No analysis found for clip {clip_id}")
        return ""
    except Exception as e:
        log.error(f"[TOOL:get_transcript] Failed: {e}", exc_info=True)
        return ""


def find_stressed_moments(driver: str, session_id: str, min_stress: float = 70.0) -> list[dict]:
    """Find radio calls where stress exceeded a threshold.

    Returns list of {lap, stress, clip_id, mood} for moments above min_stress.
    """
    log.debug(f"[TOOL:find_stressed_moments] Called with driver={driver}, session={session_id}, min_stress={min_stress}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        moments = []
        for p in timeline.points:
            if p.stress_index and p.stress_index >= min_stress and p.clip_id:
                moments.append({
                    "lap": p.lap,
                    "stress": round(p.stress_index, 1),
                    "clip_id": p.clip_id,
                    "mood": str(p.mood) if p.mood else None,
                })
        log.debug(f"[TOOL:find_stressed_moments] Found {len(moments)} moments above threshold")
        return moments
    except Exception as e:
        log.error(f"[TOOL:find_stressed_moments] Failed: {e}", exc_info=True)
        return []


def get_lead_lag_info(driver: str, session_id: str) -> dict[str, Any]:
    """Get lead-lag correlation analysis between stress and pace.

    Returns peak correlation lag, correlation coefficient, and sample size.
    """
    log.debug(f"[TOOL:get_lead_lag_info] Called with driver={driver}, session={session_id}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        if not timeline.lead_lag:
            log.debug(f"[TOOL:get_lead_lag_info] No lead-lag data available")
            return {"error": "Not enough data for lead-lag analysis"}

        result = {
            "peak_lag_laps": timeline.lead_lag.peak_lag_laps,
            "peak_correlation": round(timeline.lead_lag.peak_correlation, 3),
            "n_samples": timeline.lead_lag.n_samples,
            "interpretation": timeline.lead_lag.interpretation,
            "is_significant": timeline.lead_lag.is_significant,
        }
        log.debug(f"[TOOL:get_lead_lag_info] Returning lag={result['peak_lag_laps']}, corr={result['peak_correlation']}, n={result['n_samples']}")
        return result
    except Exception as e:
        log.error(f"[TOOL:get_lead_lag_info] Failed: {e}", exc_info=True)
        return {"error": str(e)}




def get_track_conditions(driver: str, session_id: str, lap: int | None = None) -> dict[str, Any]:
    """Weather and grip: at one lap, or a session summary if no lap is given."""
    log.debug(f"[TOOL:get_track_conditions] Called with driver={driver}, session={session_id}, lap={lap}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        if lap is not None:
            point = next((p for p in timeline.points if p.lap == lap), None)
            if point is None or point.track is None:
                log.debug(f"[TOOL:get_track_conditions] No track data for lap {lap}")
                return {"error": f"No track data for lap {lap}"}
            log.debug(f"[TOOL:get_track_conditions] Returning single-lap track data for lap {lap}")
            return {"lap": lap, **point.track.model_dump(exclude_none=True)}

        ctx = timeline.session_context
        if ctx is None:
            log.debug(f"[TOOL:get_track_conditions] No race context available")
            return {"error": "No race context built for this session"}
        temps = [(e.lap, e.track_temp_c) for e in ctx.track_evolution if e.track_temp_c is not None]
        wet = [e.lap for e in ctx.track_evolution if e.rainfall]
        summary: dict[str, Any] = {
            "wet_dry_crossover_laps": ctx.wet_dry_crossovers,
            "wet_laps": [wet[0], wet[-1]] if wet else [],
            "n_wet_laps": len(wet),
        }
        if temps:
            summary["track_temp_c"] = {
                "at_lap_1": temps[0][1],
                "min": min(t[1] for t in temps),
                "min_at_lap": min(temps, key=lambda t: t[1])[0],
                "max": max(t[1] for t in temps),
                "max_at_lap": max(temps, key=lambda t: t[1])[0],
                "final": temps[-1][1],
            }
        log.debug(f"[TOOL:get_track_conditions] Returning session summary (wet_laps={len(wet)})")
        return summary
    except Exception as e:
        log.error(f"[TOOL:get_track_conditions] Failed: {e}", exc_info=True)
        return {"error": str(e)}


def get_tyre_state(driver: str, session_id: str, lap: int | None = None) -> dict[str, Any]:
    """Modelled tyre condition. All degradation figures are inferred, not measured."""
    log.debug(f"[TOOL:get_tyre_state] Called with driver={driver}, session={session_id}, lap={lap}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        note = (
            "Degradation is MODELLED from compound, tyre age and lap-time trend. "
            "No public source has real F1 tyre temperature, pressure or wear."
        )
        if lap is not None:
            point = next((p for p in timeline.points if p.lap == lap), None)
            if point is None or point.tyre is None:
                log.debug(f"[TOOL:get_tyre_state] No tyre data for lap {lap}")
                return {"error": f"No tyre data for lap {lap}"}
            log.debug(f"[TOOL:get_tyre_state] Returning single-lap tyre data for lap {lap}")
            return {"lap": lap, "note": note, **point.tyre.model_dump(exclude_none=True)}

        ctx = timeline.session_context
        if ctx is None:
            log.debug(f"[TOOL:get_tyre_state] No race context available")
            return {"error": "No race context built for this session"}
        stints = ctx.stints_by_driver.get(driver.upper(), [])
        log.debug(f"[TOOL:get_tyre_state] Returning {len(stints)} stints for driver")
        return {"note": note, "stints": [st.model_dump(exclude_none=True) for st in stints]}
    except Exception as e:
        log.error(f"[TOOL:get_tyre_state] Failed: {e}", exc_info=True)
        return {"error": str(e)}


def get_clip_context(clip_id: str, session_id: str, driver: str) -> dict[str, Any]:
    """Everything that was true when one radio call was transmitted.

    This is the tool for "where on the lap was the driver" and "what was happening
    around them" — corner, speed, tyre age, track temperature, flags, gaps.
    """
    log.debug(f"[TOOL:get_clip_context] Called with clip_id={clip_id}, session={session_id}, driver={driver}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        ctx = timeline.clip_contexts.get(clip_id)
        if ctx is None:
            log.debug(f"[TOOL:get_clip_context] No context found for clip {clip_id}")
            return {"error": f"No resolved context for clip {clip_id}"}
        out = ctx.model_dump(exclude_none=True)
        # The full race-control window is mostly blue flags for other cars and
        # would swamp the model's context for no benefit.
        sit = out.get("situation") or {}
        msgs = sit.get("nearby_messages") or []
        sit["nearby_messages"] = sorted(msgs, key=lambda m: abs(m.get("offset_s", 0)))[:4]
        log.debug(f"[TOOL:get_clip_context] Returning context for clip {clip_id}")
        return out
    except Exception as e:
        log.error(f"[TOOL:get_clip_context] Failed: {e}", exc_info=True)
        return {"error": str(e)}


def get_race_situation(driver: str, session_id: str, lap: int) -> dict[str, Any]:
    """Track position, gaps and flags on one lap."""
    log.debug(f"[TOOL:get_race_situation] Called with driver={driver}, session={session_id}, lap={lap}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        point = next((p for p in timeline.points if p.lap == lap), None)
        if point is None or point.situation is None:
            log.debug(f"[TOOL:get_race_situation] No situation data for lap {lap}")
            return {"error": f"No situation data for lap {lap}"}
        out = point.situation.model_dump(exclude_none=True)
        msgs = out.get("nearby_messages") or []
        out["nearby_messages"] = sorted(msgs, key=lambda m: abs(m.get("offset_s", 0)))[:4]
        log.debug(f"[TOOL:get_race_situation] Returning situation for lap {lap}")
        return {"lap": lap, **out}
    except Exception as e:
        log.error(f"[TOOL:get_race_situation] Failed: {e}", exc_info=True)
        return {"error": str(e)}


def get_session_summary(driver: str, session_id: str) -> dict[str, Any]:
    """Orientation: race length, stints, weather shape, and what data exists.

    Worth calling first on an open-ended question — it says which domains are
    populated, so the agent can avoid promising an answer it has no data for.
    """
    log.debug(f"[TOOL:get_session_summary] Called with driver={driver}, session={session_id}")
    try:
        timeline = _timeline(session_id, driver, "fusion")
        ctx = timeline.session_context
        clips = timeline.clips
        phases: dict[str, int] = {}
        for c in timeline.clip_contexts.values():
            phases[c.phase or "unknown"] = phases.get(c.phase or "unknown", 0) + 1
        out: dict[str, Any] = {
            "session": timeline.session.event_name,
            "year": timeline.session.year,
            "driver": timeline.driver,
            "n_laps": len(timeline.points),
            "n_radio_clips": len(clips),
            "radio_by_phase": phases,
            "has_race_context": ctx is not None,
            "has_biometrics": timeline.biometrics is not None,
            "stress_calibration": timeline.baseline.source if timeline.baseline else None,
        }
        if ctx is not None:
            out["circuit_corners"] = ctx.circuit_corners
            out["wet_dry_crossover_laps"] = ctx.wet_dry_crossovers
            out["n_stints"] = len(ctx.stints_by_driver.get(driver.upper(), []))
        if timeline.lead_lag:
            out["lead_lag"] = {
                "peak_lag_laps": timeline.lead_lag.peak_lag_laps,
                "n_samples": timeline.lead_lag.n_samples,
                "is_significant": timeline.lead_lag.is_significant,
            }
        log.debug(f"[TOOL:get_session_summary] Returning summary: {out['n_laps']} laps, {out['n_radio_clips']} clips")
        return out
    except Exception as e:
        log.error(f"[TOOL:get_session_summary] Failed: {e}", exc_info=True)
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
    {
        "type": "function",
        "function": {
            "name": "get_session_summary",
            "description": "Orientation for a session: race length, number of radio calls and how they split between grid/racing/post-flag, which context domains have data, stint count, weather shape. Call this first for open-ended questions so you know what data exists before promising an answer.",
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
            "name": "get_track_conditions",
            "description": "Track and air temperature, rainfall, humidity, wind, and a field-median-lap-time grip proxy. Pass a lap for that lap's conditions, or omit it for a session summary including the wet/dry crossover laps. Use for any question about weather, temperature, rain, or grip.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {"type": "string", "description": "3-letter driver code"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                    "lap": {"type": "integer", "description": "Lap number; omit for a session summary"},
                },
                "required": ["driver", "session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tyre_state",
            "description": "Tyre compound, age, stint number and MODELLED degradation in seconds per lap. Pass a lap for that lap, or omit for every stint. IMPORTANT: degradation is inferred from lap-time trend — there is no public source of real F1 tyre temperature, pressure or wear, so never describe these as measurements.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {"type": "string", "description": "3-letter driver code"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                    "lap": {"type": "integer", "description": "Lap number; omit for all stints"},
                },
                "required": ["driver", "session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_clip_context",
            "description": "Everything that was true when one radio call was transmitted: which lap, how far into the lap in metres, the nearest numbered corner, sector, speed/throttle/brake/gear/DRS, tyre compound and age, track temperature, race position, gap to the car ahead, and nearby race-control messages. This is the tool for 'where on the lap was the driver when they said that'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "clip_id": {"type": "string", "description": "Clip identifier, e.g. '2024-british-r-HAM-160752'"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                    "driver": {"type": "string", "description": "3-letter driver code"},
                },
                "required": ["clip_id", "session_id", "driver"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_race_situation",
            "description": "Race position, gap to the car ahead, gap to the leader, whether the driver was in traffic, track status and race-control flags on a given lap. Use for questions about overtaking, defending, traffic, safety cars, flags or penalties.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver": {"type": "string", "description": "3-letter driver code"},
                    "session_id": {"type": "string", "description": "Session identifier"},
                    "lap": {"type": "integer", "description": "Lap number"},
                },
                "required": ["driver", "session_id", "lap"],
            },
        },
    },
]


# Map tool names to actual Python functions
TOOL_MAP = {
    # Voice / pace — the original five
    "get_stress_series": get_stress_series,
    "get_lap_deltas": get_lap_deltas,
    "get_transcript": get_transcript,
    "find_stressed_moments": find_stressed_moments,
    "get_lead_lag_info": get_lead_lag_info,
    # Race context
    "get_session_summary": get_session_summary,
    "get_track_conditions": get_track_conditions,
    "get_tyre_state": get_tyre_state,
    "get_clip_context": get_clip_context,
    "get_race_situation": get_race_situation,
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
    log.info(f"[ASK_PIT_WALL] New question received")
    log.info(f"[ASK_PIT_WALL] Question: {req.question}")
    log.info(f"[ASK_PIT_WALL] Session: {req.session_id}, Driver: {req.driver}")

    # Input validation
    if not req.question or not req.question.strip():
        log.warning(f"[ASK_PIT_WALL] Empty question rejected")
        raise HTTPException(400, "Question cannot be empty")

    # Check cache first
    cache = get_cache()
    log.debug(f"[ASK_PIT_WALL] Checking cache for question")
    cached = cache.get(req.question, req.session_id, req.driver)
    if cached is not None:
        log.info(f"[ASK_PIT_WALL] Cache HIT - returning cached response")
        log.debug(f"[ASK_PIT_WALL] Cached answer: {cached.get('answer', '')[:100]}...")
        return AgentResponse(**cached)

    log.info(f"[ASK_PIT_WALL] Cache MISS - executing agent loop")

    try:
        log.debug(f"[ASK_PIT_WALL] Initializing Groq client")
        client = groq_client.client()
        model = groq_client.resolve_model()
        log.info(f"[ASK_PIT_WALL] Using model: {model}")
    except groq_client.GroqUnavailable as exc:
        log.error(f"[ASK_PIT_WALL] Groq client unavailable: {exc}")
        # 503, not 500: the service is fine, the LLM behind it is not configured.
        raise HTTPException(503, str(exc)) from exc

    # System prompt that prevents hallucination
    system_prompt = agent_config.SYSTEM_PROMPT_TEMPLATE.format(
        driver=req.driver,
        session_id=req.session_id
    )
    log.debug(f"[ASK_PIT_WALL] System prompt configured (length: {len(system_prompt)} chars)")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.question},
    ]

    tools_used = []
    log.info(f"[ASK_PIT_WALL] Starting agent loop (max iterations: {agent_config.AGENT_MAX_ITERATIONS})")

    for iteration in range(agent_config.AGENT_MAX_ITERATIONS):
        log.info(f"[ASK_PIT_WALL] Iteration {iteration + 1}/{agent_config.AGENT_MAX_ITERATIONS}")

        try:
            log.debug(f"[ASK_PIT_WALL] Calling Groq API (messages count: {len(messages)})")
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                max_tokens=agent_config.AGENT_MAX_TOKENS,
                temperature=agent_config.AGENT_TEMPERATURE,
            )
            log.debug(f"[ASK_PIT_WALL] Groq API responded successfully")
        except Exception as e:
            log.error(f"[ASK_PIT_WALL] Groq API call failed: {e}")
            raise HTTPException(500, f"Agent failed: {str(e)}")

        assistant_message = response.choices[0].message

        # If no tool calls, we have the final answer
        if not assistant_message.tool_calls:
            final_answer = assistant_message.content or "I couldn't generate an answer."
            log.info(f"[ASK_PIT_WALL] Agent completed - no more tool calls needed")
            log.info(f"[ASK_PIT_WALL] Final answer: {final_answer[:200]}...")
            log.info(f"[ASK_PIT_WALL] Total tools used: {len(set(tools_used))} unique, {len(tools_used)} total calls")
            log.debug(f"[ASK_PIT_WALL] Tools called: {', '.join(tools_used)}")

            response = AgentResponse(answer=final_answer, tools_used=tools_used)

            # Cache the response
            log.debug(f"[ASK_PIT_WALL] Caching response")
            cache.set(req.question, req.session_id, req.driver, response.model_dump())

            return response

        # Execute tool calls
        log.info(f"[ASK_PIT_WALL] Agent requested {len(assistant_message.tool_calls)} tool calls")

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

        for idx, tool_call in enumerate(assistant_message.tool_calls, 1):
            func_name = tool_call.function.name
            tools_used.append(func_name)

            log.info(f"[ASK_PIT_WALL] Tool call {idx}/{len(assistant_message.tool_calls)}: {func_name}")
            log.debug(f"[ASK_PIT_WALL] Tool ID: {tool_call.id}")
            log.debug(f"[ASK_PIT_WALL] Raw arguments: {tool_call.function.arguments}")

            try:
                # Parse arguments and call the function
                args = json.loads(tool_call.function.arguments)
                log.info(f"[ASK_PIT_WALL] Calling {func_name} with args: {args}")

                func = TOOL_MAP.get(func_name)

                if not func:
                    log.error(f"[ASK_PIT_WALL] Unknown tool requested: {func_name}")
                    result = {"error": f"Unknown tool: {func_name}"}
                else:
                    result = func(**args)
                    result_preview = str(result)[:200] if result else "None"
                    log.info(f"[ASK_PIT_WALL] Tool {func_name} returned: {result_preview}...")
                    log.debug(f"[ASK_PIT_WALL] Full result: {result}")

                # Send result back to the agent
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })
            except json.JSONDecodeError as e:
                log.error(f"[ASK_PIT_WALL] Failed to parse arguments for {func_name}: {e}")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps({"error": f"Invalid JSON arguments: {str(e)}"}),
                })
            except Exception as e:
                log.error(f"[ASK_PIT_WALL] Tool {func_name} failed: {e}", exc_info=True)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps({"error": str(e)}),
                })

    # Max iterations reached
    log.warning(f"[ASK_PIT_WALL] Max iterations ({agent_config.AGENT_MAX_ITERATIONS}) reached without completion")
    log.warning(f"[ASK_PIT_WALL] Tools used before timeout: {', '.join(tools_used)}")

    response = AgentResponse(
        answer="I couldn't complete the analysis - too many steps required.",
        tools_used=tools_used,
    )

    # Cache even failed responses to avoid retrying
    log.debug(f"[ASK_PIT_WALL] Caching incomplete response to prevent retries")
    cache.set(req.question, req.session_id, req.driver, response.model_dump())

    return response
