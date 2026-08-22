"""LLM-authored top findings.

Distinct from `strategy.py` on purpose, and the distinction is the whole design.

`strategy.py` is a set of rules. Same input, same call, every time — because a pit
wall that gets a different answer on a reload learns to ignore the tool. That file
stays exactly as it is.

This module does the thing rules cannot: read every domain at once and say which
five or six things mattered. That needs a language model, which means it needs
guardrails, which is what most of this file is.

Three guardrails, in order of importance:

1. **The context block is built by us, not fetched by the model.** The chat agent
   in `routers/agent.py` gives the model tools and lets it choose; that is right
   for answering a question and wrong for writing a briefing, because a model
   deciding what to look at will not look at what it did not think of. Here we
   hand it everything, deterministically ordered.

2. **The citation gate.** Every finding must name the laps it is about. After
   generation we check those laps exist in the data, and drop the finding if they
   do not. The count of dropped findings is returned, not swallowed — a session
   where the model invents laps is a session whose findings deserve less trust,
   and hiding that would be the exact failure the README claims not to have.

3. **A forced tool call for the schema.** Free-text JSON from a 70B model needs a
   parser and a retry loop; a forced function call gets validated at the API
   boundary instead. Same mechanism `routers/agent.py` already uses.

The context block is byte-deterministic for a given input, which is what makes the
one-hour response cache worth having.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app import agent_config, groq_client
from app.schemas import (
    ClipContext,
    Finding,
    FindingsResponse,
    ScoringMode,
    SessionContext,
    Timeline,
    Urgency,
)

log = logging.getLogger(__name__)

# The schema the model must fill. Kept as a literal rather than derived from the
# Pydantic model: the wire format the LLM sees should change only when we mean it
# to, not as a side effect of adding a field for the UI.
EMIT_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_findings",
        "description": "Return the ranked findings for this driver and session.",
        "parameters": {
            "type": "object",
            "properties": {
                "findings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "rank": {"type": "integer", "description": "1 = tell the engineer this first"},
                            "severity": {"type": "string", "enum": ["info", "warning", "critical"]},
                            "headline": {"type": "string", "description": "One line, engineer language"},
                            "detail": {"type": "string", "description": "Two to four sentences"},
                            "laps": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "Laps this finding is about. Checked against the data.",
                            },
                            "domains": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "enum": ["stress", "pace", "track", "tyre", "position", "situation", "radio"],
                                },
                            },
                            "evidence": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "The actual numbers behind the claim, one per string",
                            },
                            "confidence": {"type": "number", "description": "0-1; <=0.5 when resting on few readings"},
                        },
                        "required": ["rank", "severity", "headline", "detail", "laps", "domains", "evidence", "confidence"],
                    },
                }
            },
            "required": ["findings"],
        },
    },
}


# ═══════════════════════════════════════════════════════════════════════════
# Context block
# ═══════════════════════════════════════════════════════════════════════════


def _fmt(value: Any, spec: str = "", dash: str = "-") -> str:
    if value is None:
        return dash
    if spec:
        return format(value, spec)
    return str(value)


def _track_summary(ctx: SessionContext) -> list[str]:
    ev = [e for e in ctx.track_evolution if e.track_temp_c is not None]
    if not ev:
        return []
    lo = min(ev, key=lambda e: e.track_temp_c)
    hi = max(ev, key=lambda e: e.track_temp_c)
    lines = [
        f"  track temp: {ev[0].track_temp_c}C at lap {ev[0].lap} | "
        f"low {lo.track_temp_c}C at lap {lo.lap} | high {hi.track_temp_c}C at lap {hi.lap} | "
        f"{ev[-1].track_temp_c}C at lap {ev[-1].lap}"
    ]
    wet = [e.lap for e in ctx.track_evolution if e.rainfall]
    if wet:
        lines.append(f"  rainfall sensor wet on laps {wet[0]}-{wet[-1]} ({len(wet)} laps)")
        if ctx.wet_dry_crossovers:
            lines.append(f"  wet/dry crossovers at laps: {', '.join(map(str, ctx.wet_dry_crossovers))}")
    else:
        lines.append("  rainfall: dry throughout")

    grip = [e for e in ctx.track_evolution if e.grip_proxy_s is not None]
    if grip:
        g_lo = min(grip, key=lambda e: e.grip_proxy_s)
        g_hi = max(grip, key=lambda e: e.grip_proxy_s)
        lines.append(
            f"  field median lap time: fastest {g_lo.grip_proxy_s}s (lap {g_lo.lap}), "
            f"slowest {g_hi.grip_proxy_s}s (lap {g_hi.lap}) — a grip proxy, not a measurement"
        )
    return lines


def _stint_lines(ctx: SessionContext, driver: str) -> list[str]:
    stints = ctx.stints_by_driver.get(driver.upper(), [])
    if not stints:
        return []
    out = ["  stint compound      laps    modelled deg    best lap"]
    for s in stints:
        deg = "n/a" if s.deg_slope_s_per_lap is None else f"{s.deg_slope_s_per_lap:+.3f} s/lap"
        best = "-" if s.best_lap_s is None else f"{s.best_lap_s:.3f}s"
        out.append(
            f"  {s.stint_number:<5} {(s.compound or '?'):<13} {s.lap_start:>2}-{s.lap_end:<4} {deg:>15}    {best}"
        )
    return out


def _phase_conflicts(timeline: Timeline) -> list[tuple[int, str, str]]:
    """Laps whose stress reading came from radio that was not on a racing lap.

    These exist because `index.csv` assigns a lap to every clip, including grid
    and post-flag radio, while the context resolver bounds a lap by its actual
    start and end and reports None outside it. Where the two disagree, the lap's
    stress value is real but is not a measurement of racing stress.

    Hamilton's 2024 British GP is the clean example: his victory radio scores 97.6
    "Stressed" — the classifier is not wrong, elation and stress share an acoustic
    signature — and it is filed against lap 52. A findings layer that could not see
    the conflict would confidently report a driver falling apart on the last lap of
    a race he had just won.

    We surface this rather than correcting it. The lap assignment feeds the
    deterministic strategy layer and the lead-lag correlation, and quietly changing
    what those compute is not this module's call to make.
    """
    conflicts: list[tuple[int, str, str]] = []
    for clip in timeline.clips:
        if clip.lap is None:
            continue
        ctx = timeline.clip_contexts.get(clip.clip_id)
        if ctx is None or ctx.phase in (None, "racing"):
            continue
        conflicts.append((clip.lap, ctx.phase, clip.clip_id))
    return sorted(conflicts)


def _laps_worth_showing(timeline: Timeline) -> set[int]:
    """The laps a compact table must not drop.

    Used when the prompt has to shrink to fit the token quota. Rather than
    sampling evenly — which would be as likely to drop the pit lap as a quiet one
    — this keeps the laps that carry information: anything with radio, any stint
    boundary, any change in the rain sensor, any lap under a flag, the extremes of
    pace, and the ends of the race. Everything else is filler that the stint and
    weather summaries already describe.
    """
    keep: set[int] = set()
    points = timeline.points
    if not points:
        return keep

    keep.add(points[0].lap)
    keep.add(points[-1].lap)

    prev_compound = None
    prev_rain = None
    for p in points:
        if p.stress_index is not None or p.clip_id:
            # A radio lap, plus its neighbours so a trend is visible around it.
            keep.update({p.lap - 1, p.lap, p.lap + 1})
        compound = p.tyre.compound if p.tyre else None
        if compound != prev_compound:
            keep.add(p.lap)
            prev_compound = compound
        rain = p.track.rainfall if p.track else None
        if rain != prev_rain:
            keep.add(p.lap)
            prev_rain = rain
        if p.situation and p.situation.active_flags:
            keep.add(p.lap)

    deltas = [(p.lap, p.delta_s) for p in points if p.delta_s is not None]
    if deltas:
        keep.add(max(deltas, key=lambda d: d[1])[0])
        keep.add(min(deltas, key=lambda d: d[1])[0])

    valid = {p.lap for p in points}
    return {l for l in keep if l in valid}


def _lap_table(timeline: Timeline, compact: bool = False) -> list[str]:
    flagged = {lap for lap, _, _ in _phase_conflicts(timeline)}
    keep = _laps_worth_showing(timeline) if compact else None
    out = [
        "  lap | pace delta | stress | mood     | compound/age  | track C | rain | flags",
    ]
    if keep is not None:
        out.append(
            f"  (showing {len(keep)} of {len(timeline.points)} laps: every lap with radio, "
            "a tyre change, a rain change, a flag, or a pace extreme. Omitted laps were "
            "unremarkable.)"
        )
    for p in timeline.points:
        if keep is not None and p.lap not in keep:
            continue
        tyre = "-"
        if p.tyre and p.tyre.compound:
            tyre = f"{p.tyre.compound}/{_fmt(p.tyre.tyre_age_laps)}"
        track_c = _fmt(p.track.track_temp_c if p.track else None)
        rain = "-"
        if p.track and p.track.rainfall is not None:
            rain = "WET" if p.track.rainfall else "dry"
        flags = ",".join(p.situation.active_flags) if p.situation and p.situation.active_flags else "-"
        out.append(
            f"  {p.lap:>3} | {_fmt(p.delta_s, '+.3f'):>10} | "
            f"{_fmt(round(p.stress_index, 1) if p.stress_index is not None else None):>6} | "
            f"{_fmt(p.mood.value if p.mood else None):<8} | {tyre:<13} | {track_c:>7} | {rain:<4} | {flags}"
            + ("   <-- stress from off-lap radio, see DATA CAVEATS" if p.lap in flagged else "")
        )
    return out


def _clip_line(clip, ctx: ClipContext | None, mode: ScoringMode, compact: bool = False) -> list[str]:
    r = clip.result_for(mode)
    head = f"  [{clip.clip_id}]"
    bits = [f"stress {r.stress_index:.1f} {r.mood.value} (conf {r.confidence:.2f})"]

    if ctx is None:
        bits.append("no context resolved")
        return [f"{head} {' | '.join(bits)}", f'    "{clip.transcript.text.strip()}"']

    if ctx.phase and ctx.phase != "racing":
        bits.insert(0, ctx.phase.upper().replace("_", "-"))
    if ctx.lap is not None:
        bits.insert(0, f"lap {ctx.lap}")

    p = ctx.position
    if p and p.nearest_corner is not None:
        where = f"Turn {p.nearest_corner}"
        if p.distance_to_corner_m is not None:
            where += " approach" if p.distance_to_corner_m > 0 else " exit"
        detail = [where]
        if p.sector:
            detail.append(f"S{p.sector}")
        if p.speed_kph is not None:
            detail.append(f"{p.speed_kph:.0f}kph")
        if p.zone:
            detail.append(p.zone)
        bits.append(" ".join(detail))

    if ctx.tyre and ctx.tyre.compound:
        t = f"tyre={ctx.tyre.compound} age {_fmt(ctx.tyre.tyre_age_laps)}"
        if ctx.tyre.past_cliff:
            t += " PAST CLIFF (modelled)"
        bits.append(t)

    if ctx.track and ctx.track.track_temp_c is not None:
        # "WET" qualifies the track surface, never the tyre. A model read
        # "MEDIUM ... WET" as the driver being on wet tyres, so the two are now
        # labelled distinctly.
        t = f"track {ctx.track.track_temp_c}C"
        if ctx.track.rainfall is not None:
            t += " surface=WET" if ctx.track.rainfall else " surface=dry"
        bits.append(t)

    s = ctx.situation
    if s:
        sit = []
        if s.position:
            sit.append(f"P{s.position}")
        if s.gap_ahead_s is not None:
            # Spelled out as a gap because "+2.4s to car ahead" gets read as a
            # 2.4-second loss. A model made exactly that mistake here.
            sit.append(f"gap-to-car-ahead {s.gap_ahead_s:.1f}s")
        if s.in_traffic:
            sit.append("in traffic")
        if s.active_flags:
            sit.append("flags " + ",".join(s.active_flags))
        if sit:
            bits.append(" ".join(sit))

    lines = [f"{head} {' | '.join(bits)}", f'    "{clip.transcript.text.strip()}"']

    # Only messages that describe track state, and only the closest few — the
    # full window is mostly blue flags for other cars and would drown the block.
    if s and s.nearby_messages and not compact:
        notable = [
            m
            for m in sorted(s.nearby_messages, key=lambda m: abs(m.offset_s))
            if m.category in ("Flag", "SafetyCar", "Drs") or "GRIP" in m.message.upper()
        ][:3]
        for m in notable:
            lines.append(f"    race control {m.offset_s:+.0f}s: {m.message[:90]}")
    return lines


def build_context_block(timeline: Timeline, mode: ScoringMode, compact: bool = False) -> str:
    """Render everything we know into a deterministic prompt block.

    `compact` trims the per-lap table to the laps that carry information. Used on
    retry when the full block plus a useful output budget will not fit inside the
    account's tokens-per-minute quota.

    Deterministic matters twice over: the response cache keys on the question and
    the session, so a block that reordered itself between calls would produce
    inconsistent findings for identical data and silently defeat the cache.
    """
    ctx = timeline.session_context
    sess = timeline.session
    lines: list[str] = [
        f"SESSION: {sess.year} {sess.event_name} ({sess.session_type})",
        f"DRIVER: {timeline.driver}",
        f"SCORING MODE: {mode.value}",
        "",
        "HOW TO READ THIS DATA",
        "  pace delta      seconds vs this driver's own rolling median. + is slower.",
        "  stress          0-100 from radio voice. Not a physiological measurement.",
        "  tyre=NAME       the compound fitted. SOFT/MEDIUM/HARD are slick; "
        "INTERMEDIATE/WET are rain tyres.",
        "  tyre figures    every tyre number here is MODELLED from compound, age and "
        "lap-time trend.",
        "                  no tyre sensor data exists publicly — never write as though "
        "we measured the tyre.",
        "  surface=WET     the track is wet. It does NOT mean rain tyres are fitted; "
        "check tyre= for that.",
        "  gap-to-car-ahead  the distance in seconds to the car in front at the timing "
        "line. It is a gap, not time lost.",
    ]
    if ctx and ctx.lap_count:
        lines.append(f"RACE LENGTH: {ctx.lap_count} laps")
    if ctx and ctx.circuit_corners:
        lines.append(f"CIRCUIT: {ctx.circuit_corners} numbered corners")

    if timeline.baseline:
        b = timeline.baseline
        lines += [
            "",
            f"STRESS CALIBRATION: {b.source} baseline from {b.n_baseline_clips} calm clips",
        ]
        if b.source != "driver":
            lines.append(
                "  NOTE: not individually calibrated for this driver — treat absolute stress values with caution"
            )

    if ctx:
        t = _track_summary(ctx)
        if t:
            lines += ["", "TRACK AND WEATHER"] + t
        st = _stint_lines(ctx, timeline.driver)
        if st:
            lines += [
                "",
                "TYRE STINTS (degradation MODELLED from lap-time trend; no tyre sensor data exists)",
            ] + st

    conflicts = _phase_conflicts(timeline)
    if conflicts:
        lines += [
            "",
            "DATA CAVEATS — READ BEFORE USING THE PER-LAP STRESS COLUMN",
        ]
        for lap, phase, clip_id in conflicts:
            lines.append(
                f"  lap {lap}: the stress value on this lap comes from {phase.replace('_', '-')} "
                f"radio ({clip_id}), not from a racing lap. Do not describe it as in-race stress."
            )
        lines.append(
            "  These readings also feed the strategy calls and the lead-lag figure below, "
            "so treat both with corresponding caution."
        )

    lines += ["", "PER-LAP DATA"] + _lap_table(timeline, compact=compact)

    # Radio, split by phase so the model cannot fold grid nerves into race pace.
    by_phase: dict[str, list] = {"racing": [], "pre_race": [], "post_race": [], "unknown": []}
    for clip in timeline.clips:
        c = timeline.clip_contexts.get(clip.clip_id)
        by_phase[(c.phase if c and c.phase else "unknown")].append((clip, c))

    def sort_key(item):
        clip, c = item
        return (c.lap if c and c.lap is not None else 0, clip.clip_id)

    if by_phase["racing"]:
        lines += ["", f"RADIO CALLS DURING RACING LAPS ({len(by_phase['racing'])})"]
        for clip, c in sorted(by_phase["racing"], key=sort_key):
            lines += _clip_line(clip, c, mode, compact)

    for phase, label in (("pre_race", "GRID / FORMATION LAP RADIO"), ("post_race", "POST-FLAG RADIO")):
        if by_phase[phase]:
            lines += [
                "",
                f"{label} ({len(by_phase[phase])}) — not racing laps; no tyre or position data",
            ]
            for clip, c in sorted(by_phase[phase], key=sort_key):
                lines += _clip_line(clip, c, mode, compact)

    if by_phase["unknown"]:
        lines += ["", f"RADIO WITH NO RESOLVED CONTEXT ({len(by_phase['unknown'])})"]
        for clip, c in sorted(by_phase["unknown"], key=sort_key):
            lines += _clip_line(clip, c, mode, compact)

    if timeline.strategy_calls:
        lines += [
            "",
            "DETERMINISTIC STRATEGY CALLS (rule-based, reproducible — cite these, do not contradict them)",
        ]
        for c in timeline.strategy_calls:
            lines.append(f"  lap {c.lap:>3} [{c.urgency.value}] {c.code}: {c.rationale}")

    if timeline.lead_lag:
        ll = timeline.lead_lag
        lines += [
            "",
            "STRESS/PACE LEAD-LAG",
            f"  peak correlation r={ll.peak_correlation:.3f} at lag {ll.peak_lag_laps} laps, n={ll.n_samples}",
            f"  {ll.interpretation}",
            f"  statistically significant: {ll.is_significant}",
        ]

    if timeline.biometrics:
        b = timeline.biometrics
        lines += [
            "",
            f"DRIVER BIOMETRICS ({b.n_samples} samples from {b.source})",
            f"  heart-rate baseline {b.hr_baseline_bpm} bpm (sd {b.hr_baseline_sd})",
        ]
        if b.coverage_note:
            lines.append(f"  NOTE: {b.coverage_note}")
    else:
        lines += ["", "DRIVER BIOMETRICS: none uploaded for this driver — do not speculate about heart rate"]

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# Citation gate
# ═══════════════════════════════════════════════════════════════════════════


def _known_laps(timeline: Timeline) -> set[int]:
    laps = {p.lap for p in timeline.points}
    if timeline.session_context:
        laps |= {e.lap for e in timeline.session_context.track_evolution}
    return laps


def _present_domains(timeline: Timeline) -> set[str]:
    """Which domains the context actually contains, for validating `domains`."""
    present = {"stress", "pace", "radio"}
    for p in timeline.points:
        if p.track and p.track.track_temp_c is not None:
            present.add("track")
        if p.tyre and p.tyre.compound:
            present.add("tyre")
        if p.situation and (p.situation.position or p.situation.active_flags):
            present.add("situation")
    for c in timeline.clip_contexts.values():
        if c.position and c.position.nearest_corner is not None:
            present.add("position")
    return present


def validate(raw: list[dict], timeline: Timeline) -> tuple[list[Finding], int]:
    """Keep only findings whose citations check out.

    A model writing about lap 58 of a 52-lap race is not making a small error; it
    has lost track of the data and everything else it said is suspect. Dropping
    the finding is the mild response. The count is returned so the caller can
    surface it.
    """
    known = _known_laps(timeline)
    domains = _present_domains(timeline)
    kept: list[Finding] = []
    dropped = 0

    for item in raw:
        try:
            laps = [int(x) for x in (item.get("laps") or [])]
        except (TypeError, ValueError):
            dropped += 1
            continue

        unknown = [l for l in laps if l not in known]
        if unknown:
            log.warning("dropping finding citing unknown laps %s: %r", unknown, item.get("headline"))
            dropped += 1
            continue
        if not laps:
            # A finding about nothing in particular cannot be checked and cannot
            # be clicked through to in the UI.
            log.warning("dropping finding with no lap citation: %r", item.get("headline"))
            dropped += 1
            continue

        claimed = [d for d in (item.get("domains") or []) if d in domains]
        try:
            kept.append(
                Finding(
                    rank=int(item.get("rank", len(kept) + 1)),
                    severity=Urgency(str(item.get("severity", "info")).lower()),
                    headline=str(item.get("headline", "")).strip(),
                    detail=str(item.get("detail", "")).strip(),
                    laps=sorted(set(laps)),
                    domains=claimed,
                    evidence=[str(e) for e in (item.get("evidence") or [])],
                    confidence=max(0.0, min(1.0, float(item.get("confidence", 0.5)))),
                )
            )
        except Exception as exc:
            log.warning("dropping malformed finding %r: %s", item.get("headline"), exc)
            dropped += 1

    kept = [f for f in kept if f.headline]
    kept.sort(key=lambda f: f.rank)
    # Renumber so ranks are contiguous after drops; a list jumping 1,2,4 invites
    # the reader to wonder what happened to 3.
    for i, f in enumerate(kept, start=1):
        f.rank = i
    return kept, dropped


# ═══════════════════════════════════════════════════════════════════════════
# Generation
# ═══════════════════════════════════════════════════════════════════════════


def estimate_tokens(text: str) -> int:
    """A deliberately pessimistic token count for a prompt.

    We cannot run Groq's tokeniser locally, and under-estimating here costs a 413
    that fails the whole request, while over-estimating only shortens the output a
    little. 3.2 chars per token is well below English prose (~4) and accounts for
    this prompt being dense with numbers and punctuation, which tokenise worse.
    """
    return int(len(text) / 3.2) + 1


def output_budget(prompt: str) -> int:
    """How many output tokens we can ask for without tripping the TPM limit.

    Groq charges `prompt + max_tokens` against the per-minute quota before running
    the request, so this is a hard constraint rather than a tuning knob.
    """
    room = agent_config.GROQ_TPM_LIMIT - agent_config.GROQ_TPM_MARGIN - estimate_tokens(prompt)
    return max(agent_config.FINDINGS_MIN_TOKENS, min(agent_config.FINDINGS_MAX_TOKENS, room))


class FindingsUnavailable(RuntimeError):
    """Raised with a message safe to show the user."""


def _looks_truncated(exc: Exception) -> bool:
    """Whether a Groq error is really an output-length problem.

    Groq reports a tool call cut off mid-JSON as `tool_use_failed` /
    "Failed to parse tool call arguments as JSON", with no indication that length
    was the cause. Matching on that signature is unlovely but it is the only
    signal available, and the alternative is failing on a condition we can fix by
    asking for less.
    """
    text = str(exc)
    return "tool_use_failed" in text or "parse tool call arguments" in text


def _looks_rate_limited(exc: Exception) -> bool:
    """Whether a Groq error is a token quota rather than a real fault."""
    text = str(exc)
    # Both the machine-readable code and the prose are matched: Groq sends the
    # code in the error body today, but a 429 whose wording changes must not be
    # reported to the user as "the model is unavailable" — that reads as a fault
    # and sends them looking for a broken deployment instead of a spent quota.
    return (
        "rate_limit_exceeded" in text
        or "Rate limit reached" in text
        or "Request too large" in text
        or "413" in text
    )


def _is_daily_quota(exc: Exception) -> bool:
    """Whether the exhausted quota is the per-day one rather than per-minute.

    The difference is everything for the caller. A per-minute limit clears on its
    own in seconds, so "wait a moment and regenerate" is honest advice. A per-day
    limit does not, and telling someone to retry in a moment sends them pressing
    a button that cannot work for hours — which is exactly what happened to a
    prewarm run that read a TPD rejection as a transient one.
    """
    return "(TPD)" in str(exc) or "tokens per day" in str(exc)


def quota_retry_hint(exc: Exception) -> float | None:
    """Seconds Groq says to wait, from "Please try again in 16m55.632s".

    Both units are optional and either can be absent, so the minutes and seconds
    groups are matched separately rather than assuming one shape. Returns None
    when the error carries no hint.
    """
    match = re.search(r"try again in (?:([\d.]+)m)?([\d.]+)s", str(exc))
    if not match:
        return None
    minutes, seconds = match.groups()
    return (float(minutes) * 60 if minutes else 0.0) + float(seconds)


def generate(timeline: Timeline, mode: ScoringMode) -> FindingsResponse:
    """One Groq call, schema-forced, citation-checked."""
    try:
        client = groq_client.client()
    except groq_client.GroqUnavailable as exc:
        raise FindingsUnavailable(str(exc)) from exc

    if not timeline.clips:
        raise FindingsUnavailable(
            f"No analysed radio clips for {timeline.driver} in this session, so there is nothing to write findings from."
        )

    block = build_context_block(timeline, mode)
    model = groq_client.resolve_model()

    # Ask for the full set first, then fewer if the model overruns its budget.
    # A truncated tool call comes back from Groq as an opaque "Failed to parse tool
    # call arguments as JSON", so we detect it by that signature and shorten the
    # ask rather than surfacing a parse error the user cannot act on.
    attempts = [agent_config.FINDINGS_TARGET_COUNT, *agent_config.FINDINGS_RETRY_COUNTS]
    last_error: Exception | None = None

    for attempt_no, target in enumerate(attempts):
        system = agent_config.FINDINGS_SYSTEM_PROMPT.format(target_count=target)
        # Rebuild the block more tersely on each retry: a retry is triggered either
        # by running out of output room or by the quota rejecting the request, and
        # both are helped by a shorter prompt.
        attempt_block = block if attempt_no == 0 else build_context_block(
            timeline, mode, compact=True
        )
        budget = output_budget(system + attempt_block)
        log.info(
            "findings attempt %d: target=%d prompt~%d tokens, max_tokens=%d",
            attempt_no + 1,
            target,
            estimate_tokens(system + attempt_block),
            budget,
        )
        kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": attempt_block},
            ],
            "tools": [EMIT_TOOL],
            "tool_choice": {"type": "function", "function": {"name": "emit_findings"}},
            "max_tokens": budget,
            "temperature": agent_config.FINDINGS_TEMPERATURE,
        }
        # Only the gpt-oss family accepts this, and an unknown parameter is a hard
        # 400 elsewhere — so it is opt-in by model rather than always sent. It goes
        # via `extra_body` because the pinned groq SDK (0.11.0, held back by an
        # httpx incompatibility) predates the parameter and rejects it as a kwarg.
        if model.startswith("openai/gpt-oss"):
            kwargs["extra_body"] = {"reasoning_effort": agent_config.FINDINGS_REASONING_EFFORT}

        try:
            response = client.chat.completions.create(**kwargs)
        except Exception as exc:
            last_error = exc
            if (_looks_truncated(exc) or _looks_rate_limited(exc)) and target != attempts[-1]:
                log.warning(
                    "findings attempt %d failed (%s); retrying with a shorter prompt",
                    attempt_no + 1,
                    "quota" if _looks_rate_limited(exc) else "truncation",
                )
                continue
            if _looks_rate_limited(exc):
                hint = quota_retry_hint(exc)
                if _is_daily_quota(exc):
                    when = (
                        f" The quota frees up in about {hint / 60:.0f} min."
                        if hint
                        else ""
                    )
                    raise FindingsUnavailable(
                        "The findings model has used its whole daily token allowance, so "
                        "regenerating will not help until it resets." + when +
                        " Raise the tier on the Groq account to lift it."
                    ) from exc
                when = f" Try again in about {hint:.0f}s." if hint else " Wait a moment and try again."
                raise FindingsUnavailable(
                    "The findings model hit its per-minute token limit." + when
                ) from exc
            log.error("findings generation failed: %s", exc)
            raise FindingsUnavailable(f"The findings model is unavailable: {exc}") from exc

        calls = response.choices[0].message.tool_calls or []
        if not calls:
            last_error = RuntimeError("no tool call")
            if target != attempts[-1]:
                continue
            raise FindingsUnavailable("The model returned no findings.")
        try:
            payload = json.loads(calls[0].function.arguments)
        except json.JSONDecodeError as exc:
            last_error = exc
            if target != attempts[-1]:
                log.warning("malformed findings JSON at target=%d; retrying smaller", target)
                continue
            raise FindingsUnavailable("The model returned malformed findings.") from exc
        break
    else:  # pragma: no cover - the loop always breaks or raises
        raise FindingsUnavailable(f"Could not generate findings: {last_error}")

    findings, dropped = validate(payload.get("findings") or [], timeline)

    return FindingsResponse(
        session_id=timeline.session.session_id,
        driver=timeline.driver,
        mode=mode,
        findings=findings,
        model=model,
        context_domains=sorted(_present_domains(timeline)),
        dropped_findings=dropped,
    )
