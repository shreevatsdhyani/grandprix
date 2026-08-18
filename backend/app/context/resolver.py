"""Instant -> ClipContext.

This is the heart of the context layer and the one function live mode reuses
verbatim. Its contract is deliberately narrow:

    given a bundle of session dataframes, a driver, and a UTC instant,
    say what was true

Note what is *not* in that signature: no file paths, no session ids to look up, no
network. The bundle is passed in. That is what makes the same code work against a
cached race today and a rolling live buffer later — `LiveRaceContextProvider` will
build a `SessionFrames` from its own buffer and call straight into here.

The UTC-first design matters for a second reason. Radio clips arrive with an exact
timestamp but frequently *no lap number* — 67 of the 446 clips in this repo have a
blank lap in `index.csv`, and `timeline.build()` silently drops every one of them.
Resolving from the timestamp recovers the lap, so those clips rejoin the analysis
as a side effect of asking the more precise question.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd

from app.context import position as position_mod, situation as situation_mod, track as track_mod, tyre as tyre_mod
from app.schemas import ClipContext, TrackConditions, TrackPosition

log = logging.getLogger(__name__)


@dataclass
class SessionFrames:
    """Everything the resolver needs, as dataframes rather than a session handle.

    `t0_date` is FastF1's anchor: telemetry and lap times are session-relative
    Timedeltas, and `t0_date + delta` converts them to absolute UTC. Race-control
    messages, confusingly, already carry absolute timestamps — hence the two
    different comparison paths below.
    """

    session_id: str
    t0_date: pd.Timestamp
    all_laps: pd.DataFrame
    weather: pd.DataFrame
    race_control: pd.DataFrame
    corners: pd.DataFrame
    car_data_for_lap: object = None  # callable(driver, lap_number) -> DataFrame | None
    track_temp_start: float | None = None
    grip_by_lap: dict[int, float] = field(default_factory=dict)
    median_stint_by_driver: dict[str, float] = field(default_factory=dict)

    def rel(self, when_utc: pd.Timestamp) -> pd.Timedelta:
        """Absolute UTC -> session-relative time."""
        return when_utc - self.t0_date


def lap_at(frames: SessionFrames, driver: str, when_utc: pd.Timestamp) -> int | None:
    """Which lap this driver was on at a given instant, or None if none.

    The lap in progress is the last one whose start time has passed — but it must
    also not have *finished*. Both ends matter:

    - Before the first lap starts: grid and formation-lap radio. Inventing "lap 1"
      would file pre-race nerves as racing data.
    - After the last lap ends: victory radio, cooldown laps, and radio after a
      retirement. This end is the easy one to get wrong, because the naive "last
      lap whose start has passed" answer is a real lap number that looks fine.
      Hamilton's 2024 British GP win produced two radio calls after the race
      ended, and attributing them to lap 52 hangs that lap's tyre age and gaps on
      a car already in parc fermé.

    A lap's end is taken as the next lap's start where one exists, which is robust
    when `LapTime` is unset (retirements, red flags), falling back to
    start + duration for the final lap.
    """
    laps = _driver_laps(frames, driver)
    if laps.empty or "LapStartTime" not in laps:
        return None
    rel = frames.rel(when_utc)
    started = laps[laps["LapStartTime"].notna() & (laps["LapStartTime"] <= rel)]
    if started.empty:
        return None

    current = started.iloc[-1]
    lap_no = int(current["LapNumber"])

    later = laps[laps["LapStartTime"].notna() & (laps["LapStartTime"] > rel)]
    if not later.empty:
        # A subsequent lap started, so this instant is genuinely inside `lap_no`.
        return lap_no

    # No later lap: `lap_no` is this driver's last. Check we are still within it.
    duration = current.get("LapTime")
    if pd.isna(duration):
        # An unset final lap means the driver did not complete it — a retirement
        # or the session ending under red. We cannot bound it, so accept the lap
        # rather than discard a call that probably belongs to it.
        return lap_no
    if rel <= current["LapStartTime"] + duration:
        return lap_no
    return None


def _phase(
    frames: SessionFrames, driver: str, when_utc: pd.Timestamp, lap: int | None
) -> str | None:
    """Whether this instant is before, during, or after the driver's laps."""
    if lap is not None:
        return "racing"
    laps = _driver_laps(frames, driver)
    if laps.empty or "LapStartTime" not in laps:
        return None
    starts = laps["LapStartTime"].dropna()
    if starts.empty:
        return None
    return "pre_race" if frames.rel(when_utc) < starts.min() else "post_race"


def _driver_laps(frames: SessionFrames, driver: str) -> pd.DataFrame:
    laps = frames.all_laps
    if laps is None or laps.empty or "Driver" not in laps:
        return pd.DataFrame()
    return laps[laps["Driver"] == driver.upper()].sort_values("LapNumber")


def resolve_at(
    frames: SessionFrames,
    driver: str,
    when_utc: pd.Timestamp,
    *,
    clip_id: str = "",
    biometric_series=None,
) -> ClipContext:
    """Everything that was true for one driver at one instant."""
    driver = driver.upper()
    rel = frames.rel(when_utc)
    lap = lap_at(frames, driver, when_utc)
    phase = _phase(frames, driver, when_utc, lap)

    # --- track: available even off-lap, because weather is session-wide -------
    track = track_mod.conditions_at(
        frames.weather,
        rel,
        track_temp_at_start=frames.track_temp_start,
        grip_proxy_s=frames.grip_by_lap.get(lap) if lap else None,
    )

    if lap is None:
        # Pre-race, post-flag, or in the garage. Report the track and the flags
        # honestly and leave the car-specific domains empty rather than
        # attributing them to a lap the driver was not on.
        return ClipContext(
            clip_id=clip_id,
            utc=when_utc.isoformat(),
            lap=None,
            phase=phase,
            track=track,
            situation=situation_mod.situation_at(
                frames.all_laps, frames.race_control, driver, -1, when_utc
            ),
        )

    driver_laps = _driver_laps(frames, driver)
    lap_rows = driver_laps[driver_laps["LapNumber"] == lap]
    lap_row = lap_rows.iloc[0] if not lap_rows.empty else pd.Series(dtype=object)

    # --- tyre: modelled, never measured --------------------------------------
    tyre = tyre_mod.state_at(driver_laps, lap, frames.median_stint_by_driver.get(driver))

    # --- position: needs telemetry, which may not be loaded ------------------
    pos = TrackPosition()
    if callable(frames.car_data_for_lap):
        try:
            car = frames.car_data_for_lap(driver, lap)
            if car is not None and not car.empty:
                pos = position_mod.position_at(lap_row, car, frames.corners, rel, when_utc)
        except Exception as exc:
            # Telemetry is the one domain that routinely has holes — a dropped
            # car channel for a lap should cost that lap's position data, not the
            # whole context packet.
            log.warning("telemetry resolve failed for %s lap %s: %s", driver, lap, exc)

    track_status = None
    if "TrackStatus" in lap_row and pd.notna(lap_row.get("TrackStatus")):
        track_status = str(lap_row["TrackStatus"])

    situation = situation_mod.situation_at(
        frames.all_laps, frames.race_control, driver, lap, when_utc, track_status
    )

    from app.context import biometrics as bio_mod

    return ClipContext(
        clip_id=clip_id,
        utc=when_utc.isoformat(),
        lap=lap,
        phase=phase,
        resolved_from="utc",
        track=track,
        tyre=tyre,
        position=pos,
        situation=situation,
        biometrics=bio_mod.sample_at(biometric_series, when_utc),
    )
