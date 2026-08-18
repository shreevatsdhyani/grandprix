"""Building a SessionFrames bundle from a loaded FastF1 session.

Kept separate from `resolver.py` on purpose: the resolver must not know FastF1
exists, or the live provider would inherit that dependency. This module is the
adapter, and a live implementation would write its own equivalent against its
buffer while producing the identical `SessionFrames`.
"""

from __future__ import annotations

import logging

import pandas as pd

from app.context import track as track_mod
from app.context.resolver import SessionFrames
from app.pipeline import strategy as strategy_mod
from app.schemas import Lap

log = logging.getLogger(__name__)


def _median_stint_by_driver(all_laps: pd.DataFrame) -> dict[str, float]:
    """Each driver's median stint length.

    Reuses `strategy.median_stint_length()` rather than reimplementing the same
    maths, so the tyre model and the strategy layer cannot drift apart on what
    "a long stint" means for a given driver.
    """
    out: dict[str, float] = {}
    if all_laps is None or all_laps.empty or "Driver" not in all_laps:
        return out
    for drv, g in all_laps.groupby("Driver"):
        laps = [
            Lap(lap=int(r.LapNumber), stint=None if pd.isna(r.Stint) else int(r.Stint))
            for r in g.itertuples(index=False)
            if pd.notna(r.LapNumber)
        ]
        med = strategy_mod.median_stint_length(laps)
        if med is not None:
            out[str(drv)] = med
    return out


def from_session(session, session_id: str, *, with_telemetry: bool = True) -> SessionFrames:
    """Adapt a loaded FastF1 session into the resolver's input bundle."""
    all_laps = session.laps
    weather = getattr(session, "weather_data", None)
    if weather is None:
        weather = pd.DataFrame()
    race_control = getattr(session, "race_control_messages", None)
    if race_control is None:
        race_control = pd.DataFrame()

    corners = pd.DataFrame()
    try:
        corners = session.get_circuit_info().corners
    except Exception as exc:
        # Circuit geometry comes from position data. Without it we lose corner
        # names but keep distance-into-lap, so degrade rather than fail.
        log.warning("circuit info unavailable for %s: %s", session_id, exc)

    car_data_for_lap = None
    if with_telemetry:
        def car_data_for_lap(driver: str, lap_number: int):  # noqa: F811
            rows = all_laps[
                (all_laps["Driver"] == driver.upper()) & (all_laps["LapNumber"] == lap_number)
            ]
            if rows.empty:
                return None
            # `interpolate_edges` fills the samples at the lap boundary, which
            # otherwise leaves a gap exactly where a start-line radio call lands.
            return rows.iloc[0].get_car_data(interpolate_edges=True).add_distance()

    return SessionFrames(
        session_id=session_id,
        t0_date=pd.Timestamp(session.t0_date),
        all_laps=all_laps,
        weather=weather,
        race_control=race_control,
        corners=corners,
        car_data_for_lap=car_data_for_lap,
        track_temp_start=track_mod.track_temp_at_start(weather),
        grip_by_lap=track_mod.grip_proxy_by_lap(all_laps),
        median_stint_by_driver=_median_stint_by_driver(all_laps),
    )
