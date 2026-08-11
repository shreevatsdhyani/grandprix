"""Assembling the hero chart's payload from real data.

Composes: FastF1 lap deltas + analysed radio clips + strategy calls + the
lead-lag relationship, for one driver in one session.

This is the real counterpart to `fixtures/demo.py`. The response shape is
identical, so the frontend cannot tell which one served it — only the header
badge, driven by /api/health, reports whether real models are behind it.
"""

from __future__ import annotations

import logging

from app.data import fastf1_client, store
from app.data.laps import lap_series
from app.pipeline import baseline as baseline_mod, leadlag, strategy
from app.schemas import (
    ClipAnalysis,
    DriverBaseline,
    ScoringMode,
    Timeline,
    TimelinePoint,
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

    points = [
        TimelinePoint(
            lap=l.lap,
            delta_s=l.delta_s if l.is_clean else None,
            stress_index=stress_by_lap.get(l.lap),
            mood=mood_by_lap.get(l.lap),
            clip_id=clip_by_lap.get(l.lap),
        )
        for l in laps
    ]

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
    )


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
