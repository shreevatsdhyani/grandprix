"""Assembling the hero chart's payload from real data.

Composes: FastF1 lap deltas + analysed radio clips + strategy calls + the
lead-lag relationship, for one driver in one session.

This is the real counterpart to `fixtures/demo.py`. The response shape is
identical, so the frontend cannot tell which one served it — only the header
badge, driven by /api/health, reports whether real models are behind it.
"""

from __future__ import annotations

import logging

from app.context import provider as context_provider, situation as situation_mod
from app.data import fastf1_client, store
from app.data.laps import lap_series
from app.pipeline import baseline as baseline_mod, leadlag, strategy
from app import config
from app.schemas import (
    ClipAnalysis,
    ClipContext,
    DriverBaseline,
    RaceSituation,
    ScoringMode,
    Timeline,
    TimelinePoint,
    TrackConditions,
    TyreState,
)

log = logging.getLogger(__name__)


def build(session_id: str, driver: str, mode: ScoringMode) -> Timeline:
    driver = driver.upper()
    meta = next(
        (s for s in fastf1_client.list_sessions() if s.session_id == session_id), None
    )
    if meta is None:
        raise KeyError(f"Unknown session {session_id!r}")

    laps = lap_series(session_id, driver)

    # Race context, if scripts/build_context.py has been run for this session.
    # Absent context is not an error: every field it feeds is optional and the
    # dashboard renders exactly as it did before this layer existed.
    ctx_provider = context_provider.get_provider()
    session_context = ctx_provider.session_context(session_id)
    clip_contexts: dict[str, ClipContext] = ctx_provider.contexts_for_driver(session_id, driver)
    biometrics = context_provider.load_biometrics(session_id, driver)

    # Per-lap context, taken from whichever radio call resolved on that lap. The
    # track, tyre and situation values are properties of the lap rather than of
    # the call, so any call on the lap carries the same ones.
    ctx_by_lap = {}
    for c in clip_contexts.values():
        if c.lap is not None and c.lap not in ctx_by_lap:
            ctx_by_lap[c.lap] = c

    # Race situation for EVERY lap, not just the handful with a radio call.
    #
    # Track and tyre are per-lap because they come from the lap frame and the
    # session weather curve. Situation used to come only from clip contexts, which
    # left position, gaps and flags populated on two to eleven laps out of seventy
    # — an inconsistency that made the findings prompt's flags column look empty
    # and stopped the chart from ever showing race context.
    #
    # Gaps need only lap start times and durations, and flags need only the
    # race-control feed. Both are in the light session load already cached for the
    # pace deltas, so this costs no extra I/O and no telemetry parse.
    situation_by_lap = _situation_by_lap(session_id, driver)

    # Analysed clips only. An indexed clip with no cached analysis is skipped
    # rather than shown as a blank marker — the pipeline populates the cache.
    analyses: list[ClipAnalysis] = []
    for record in store.clips_for(session_id, driver):
        cached = store.get_cached(record.clip_id)
        if cached is not None:
            analyses.append(cached)
    analyses.sort(key=lambda c: c.lap or 0)

    # Both scoring paths are precomputed per clip, so switching the A/B toggle
    # re-reads the same objects rather than re-running inference.
    readings = [
        (c.lap, c.result_for(mode).stress_index, c.result_for(mode).mood)
        for c in analyses
        if c.lap is not None
    ]
    stress_by_lap = {lap: stress for lap, stress, _ in readings}
    mood_by_lap = {lap: mood for lap, _, mood in readings}
    clip_by_lap = {c.lap: c.clip_id for c in analyses if c.lap is not None}

    points = []
    for l in laps:
        ctx = ctx_by_lap.get(l.lap)
        points.append(
            TimelinePoint(
                lap=l.lap,
                delta_s=l.delta_s if l.is_clean else None,
                stress_index=stress_by_lap.get(l.lap),
                mood=mood_by_lap.get(l.lap),
                clip_id=clip_by_lap.get(l.lap),
                track=_track_for_lap(session_context, l.lap, ctx),
                tyre=_tyre_for_lap(session_context, driver, l, ctx),
                # The clip context is richer where it exists — it carries the
                # race-control messages around the exact instant — so prefer it and
                # fall back to the per-lap computation everywhere else.
                situation=(ctx.situation if ctx and ctx.situation else situation_by_lap.get(l.lap)),
            )
        )

    calls = strategy.evaluate(
        readings, laps, median_stint=strategy.median_stint_length(laps)
    )

    return Timeline(
        session=meta,
        driver=driver,
        mode=mode,
        points=points,
        clips=analyses,
        strategy_calls=calls,
        lead_lag=leadlag.compute(stress_by_lap, laps),
        baseline=_baseline(driver, analyses),
        session_context=session_context,
        clip_contexts=clip_contexts,
        biometrics=biometrics,
    )


def _situation_by_lap(session_id: str, driver: str) -> dict[int, RaceSituation]:
    """Position, gaps and flags per lap for one driver.

    Reads the light session (no telemetry) that `lap_series` has already loaded and
    lru-cached, so this is pure computation. Returns an empty mapping on any
    failure: race context is an enhancement, and losing it must never take the
    timeline down.
    """
    try:
        session = fastf1_client.load_session(session_id)
    except Exception as exc:
        log.warning("no session for per-lap situation on %s: %s", session_id, exc)
        return {}

    try:
        gaps = situation_mod.gaps_all_laps(session.laps)
        flags = situation_mod.flags_by_lap(getattr(session, "race_control_messages", None))
    except Exception as exc:
        log.warning("per-lap situation failed for %s/%s: %s", session_id, driver, exc)
        return {}

    out: dict[int, RaceSituation] = {}
    for lap, per_driver in gaps.items():
        mine = per_driver.get(driver.upper())
        lap_flags = flags.get(lap, [])
        if mine is None and not lap_flags:
            continue
        gap_ahead = (mine or {}).get("gap_ahead_s")
        in_traffic = None
        if gap_ahead is not None:
            in_traffic = bool(gap_ahead <= config.IN_TRAFFIC_GAP_S)
        if "BLUE" in lap_flags:
            in_traffic = True
        out[lap] = RaceSituation(
            position=(mine or {}).get("position"),
            gap_ahead_s=gap_ahead,
            gap_to_leader_s=(mine or {}).get("gap_to_leader_s"),
            active_flags=lap_flags,
            in_traffic=in_traffic,
        )
    return out


def _tyre_for_lap(session_context, driver: str, lap_obj, clip_ctx):
    """Modelled tyre state for a lap.

    Prefer the resolved clip context. Otherwise compose one from the lap frame,
    which already carries compound, tyre life and stint from FastF1, plus the
    stint's degradation slope from the session context.

    Doing this for every lap rather than only laps with radio is what lets the
    chart draw continuous compound bands. Deriving it only from clip contexts
    would leave gaps on the handful of laps that happen to have a radio call,
    which looks like missing data rather than a design choice.
    """
    if clip_ctx is not None and clip_ctx.tyre is not None and clip_ctx.tyre.compound:
        return clip_ctx.tyre
    if lap_obj.compound is None and lap_obj.tyre_life is None:
        return None

    deg = None
    vs_median = None
    laps_into = None
    if session_context is not None:
        for st in session_context.stints_by_driver.get(driver.upper(), []):
            if st.lap_start <= lap_obj.lap <= st.lap_end:
                deg = st.deg_slope_s_per_lap
                laps_into = lap_obj.lap - st.lap_start + 1
                break
    return TyreState(
        compound=lap_obj.compound,
        tyre_age_laps=lap_obj.tyre_life,
        stint_number=lap_obj.stint,
        laps_into_stint=laps_into,
        deg_slope_s_per_lap=deg,
        stint_vs_driver_median_laps=vs_median,
        # Cliff detection needs the in-stint lap-time series, which lives in the
        # resolver. Left None here rather than guessed: `past_cliff=False` would
        # assert we checked.
        past_cliff=None,
    )


def _track_for_lap(session_context, lap: int, clip_ctx):
    """Track conditions for a lap.

    Prefer the resolved clip context, which is timed to the second. Fall back to
    the session-wide evolution curve so laps with no radio still carry weather —
    otherwise a compound band or rain overlay would appear only on the handful of
    laps that happen to have a radio call, which reads as missing data.
    """
    if clip_ctx is not None and clip_ctx.track is not None:
        return clip_ctx.track
    if session_context is None:
        return None
    for e in session_context.track_evolution:
        if e.lap == lap:
            return TrackConditions(
                air_temp_c=e.air_temp_c,
                track_temp_c=e.track_temp_c,
                rainfall=e.rainfall,
                grip_proxy_s=e.grip_proxy_s,
                is_wet=e.rainfall,
            )
    return None


def _baseline(driver: str, analyses: list[ClipAnalysis]) -> DriverBaseline | None:
    """Surface the driver's calm-lap reference so per-driver calibration is
    visible in the UI rather than merely claimed in the pitch.
    """
    calm = [c for c in analyses if c.fusion.mood.value == "Calm"]
    if not calm:
        return None
    n = len(calm)
    source = baseline_mod.source_for(driver)
    return DriverBaseline(
        driver=driver,
        n_baseline_clips=n,
        # Prosody features are already z-scored against the baseline, so the
        # raw reference values come from the clips themselves.
        f0_mean=round(sum(c.signals.prosody.f0_mean_z for c in calm) / n, 2),
        rms_mean=round(sum(c.signals.prosody.rms_mean_z for c in calm) / n, 4),
        speech_rate=round(sum(c.signals.prosody.speech_rate_z for c in calm) / n, 2),
        source=source,
    )
