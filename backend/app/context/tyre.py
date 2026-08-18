"""Modelled tyre state.

Read this first: **there is no public source of real F1 tyre data.** Tyre surface
and carcass temperature, pressure, and wear percentage are measured by every team
and published by none. No API has them. Any product claiming to show you a real
F1 tyre temperature is showing you a model.

So this module models. From three things F1 *does* publish — compound, tyre age,
and lap time — it infers how the set is holding up:

    deg_slope_s_per_lap   least squares of lap time against tyre age, in-stint
    past_cliff            recent laps degrading faster than the stint's own trend
    stint_vs_driver_median how unusual the length of this stint is for this driver

Every model output carries `basis="modelled"` as a *constant*, not a flag. A flag
can be forgotten; a constant means any consumer looking at the payload can see
what it is holding. The same instinct as `MoodResult.fitted` failing closed.

Two honest limits worth knowing when reading a slope:

- Fuel burn works against tyre degradation. A car gets ~0.03s/lap faster as it
  empties, so a flat slope is really mild degradation and a *negative* slope on a
  long stint is normal rather than a tyre improving.
- Traffic, safety cars and a drying track all swamp the tyre signal. We fit on
  clean laps only, which is why a stint can have plenty of laps and still return
  None.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from app import config
from app.schemas import StintSummary, TyreState

log = logging.getLogger(__name__)

# How many laps at the end of a stint count as "recent" when testing for a cliff.
CLIFF_WINDOW = 3
# Recent degradation must exceed the stint trend by this much (s/lap) to call it
# a cliff. Set above typical lap-to-lap noise so a single traffic lap cannot trip
# it.
CLIFF_EXCESS_S = 0.15


def _clean_stint_frame(stint_laps: pd.DataFrame) -> pd.DataFrame:
    """Laps within a stint usable for a degradation fit.

    Drops unset times, pit in/out laps, deleted laps, and anything not run under
    green — the same exclusions `data/laps.py` applies to the pace baseline, for
    the same reason: a 20-second pit lap is not evidence about a tyre.
    """
    df = stint_laps
    if df is None or df.empty:
        return pd.DataFrame()
    keep = df["LapTime"].notna()
    if "PitInTime" in df:
        keep &= df["PitInTime"].isna()
    if "PitOutTime" in df:
        keep &= df["PitOutTime"].isna()
    if "Deleted" in df:
        keep &= df["Deleted"] != True  # noqa: E712 — pandas object column, `is` fails
    if "TrackStatus" in df:
        keep &= df["TrackStatus"].astype(str).map(lambda s: not s or set(s) == {"1"})
    return df[keep]


def deg_slope(stint_laps: pd.DataFrame) -> float | None:
    """Seconds gained per lap of tyre age within one stint. Positive = slowing."""
    df = _clean_stint_frame(stint_laps)
    if len(df) < config.MIN_LAPS_FOR_DEG_SLOPE:
        return None
    age = df["TyreLife"].astype(float).to_numpy()
    secs = df["LapTime"].dt.total_seconds().to_numpy()
    ok = np.isfinite(age) & np.isfinite(secs)
    if ok.sum() < config.MIN_LAPS_FOR_DEG_SLOPE:
        return None
    # Age can be constant if TyreLife failed to populate; polyfit would return a
    # meaningless slope rather than raising.
    if np.ptp(age[ok]) == 0:
        return None
    slope, _ = np.polyfit(age[ok], secs[ok], 1)
    return round(float(slope), 3)


def past_cliff(stint_laps: pd.DataFrame, upto_lap: int) -> bool | None:
    """Whether the last few laps are degrading faster than the stint's own trend.

    Compared against the stint rather than an absolute threshold, because the
    same tyre falls away at wildly different rates at Monza and Singapore.
    """
    df = _clean_stint_frame(stint_laps)
    df = df[df["LapNumber"] <= upto_lap]
    if len(df) < config.MIN_LAPS_FOR_DEG_SLOPE + CLIFF_WINDOW:
        return None
    overall = deg_slope(df)
    recent = deg_slope(df.tail(CLIFF_WINDOW + 1))
    if overall is None or recent is None:
        return None
    return bool(recent - overall > CLIFF_EXCESS_S)


def summarise_stints(driver_laps: pd.DataFrame) -> list[StintSummary]:
    """One row per stint for a driver: compound, span, best lap, degradation."""
    if driver_laps is None or driver_laps.empty or "Stint" not in driver_laps:
        return []
    out: list[StintSummary] = []
    for stint_no, g in driver_laps.groupby("Stint"):
        if pd.isna(stint_no):
            continue
        timed = g[g["LapTime"].notna()]
        best = None
        if not timed.empty:
            best = round(float(timed["LapTime"].dt.total_seconds().min()), 3)
        compound = None
        if "Compound" in g and g["Compound"].notna().any():
            compound = str(g["Compound"].dropna().iloc[0])
        out.append(
            StintSummary(
                stint_number=int(stint_no),
                compound=compound,
                lap_start=int(g["LapNumber"].min()),
                lap_end=int(g["LapNumber"].max()),
                n_laps=int(len(g)),
                best_lap_s=best,
                deg_slope_s_per_lap=deg_slope(g),
            )
        )
    return sorted(out, key=lambda s: s.stint_number)


def state_at(
    driver_laps: pd.DataFrame, lap_number: int, median_stint: float | None
) -> TyreState:
    """Modelled tyre state for one driver on one lap."""
    if driver_laps is None or driver_laps.empty:
        return TyreState()
    row = driver_laps[driver_laps["LapNumber"] == lap_number]
    if row.empty:
        return TyreState()
    lap = row.iloc[0]

    stint_no = None if pd.isna(lap.get("Stint")) else int(lap["Stint"])
    stint_laps = (
        driver_laps[driver_laps["Stint"] == stint_no] if stint_no is not None else pd.DataFrame()
    )

    age = None if pd.isna(lap.get("TyreLife")) else int(lap["TyreLife"])
    laps_into = None
    if not stint_laps.empty:
        laps_into = int(lap_number - stint_laps["LapNumber"].min() + 1)

    vs_median = None
    if median_stint is not None and not stint_laps.empty:
        vs_median = int(round(len(stint_laps) - median_stint))

    return TyreState(
        compound=None if pd.isna(lap.get("Compound")) else str(lap["Compound"]),
        tyre_age_laps=age,
        stint_number=stint_no,
        laps_into_stint=laps_into,
        deg_slope_s_per_lap=deg_slope(stint_laps) if not stint_laps.empty else None,
        stint_vs_driver_median_laps=vs_median,
        past_cliff=past_cliff(stint_laps, lap_number) if not stint_laps.empty else None,
    )
