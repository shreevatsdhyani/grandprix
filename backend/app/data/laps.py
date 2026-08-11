"""Turning raw lap times into an honest pace signal.

Raw lap time is dominated by fuel burn, tyre age, traffic and safety cars. A
chart of it tells you almost nothing about whether a driver is struggling. What
we want is: *is this lap slower than this driver was going a few laps ago?*

So the y-axis everywhere is a **delta against a rolling median of the driver's
own clean laps**, and non-representative laps are excluded from that baseline
rather than smoothed over.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.data.fastf1_client import driver_laps
from app.schemas import Lap

# FastF1 encodes track status as a string of concatenated digit codes for the
# flags shown during that lap. Anything other than pure green means the lap time
# is not a measure of the driver's pace.
GREEN = "1"
TRACK_STATUS_MEANING = {
    "1": "green",
    "2": "yellow",
    "3": "unknown",
    "4": "safety car",
    "5": "red",
    "6": "VSC",
    "7": "VSC ending",
}

BASELINE_WINDOW = 5  # laps, centred


def _seconds(value: object) -> float | None:
    if pd.isna(value):
        return None
    return float(pd.Timedelta(value).total_seconds())


def _is_clean(row: pd.Series) -> bool:
    """A lap usable as a pace reference.

    Excluded: in-laps and out-laps (a pit stop adds ~20s and says nothing about
    the driver), and any lap not run entirely under green.
    """
    if pd.isna(row.get("LapTime")):
        return False
    if pd.notna(row.get("PitInTime")) or pd.notna(row.get("PitOutTime")):
        return False

    status = str(row.get("TrackStatus") or "")
    if status and set(status) != {GREEN}:
        return False

    # FastF1 marks laps the stewards deleted (track limits). They are real
    # driving but not comparable times.
    if row.get("Deleted") is True:
        return False
    return True


def lap_series(session_id: str, driver: str) -> list[Lap]:
    """Per-lap records with a pace delta, for one driver.

    The baseline is built from clean laps only, then interpolated across the
    excluded ones so that a pit lap still gets a delta — it will be large and
    positive, which is correct and visibly a pit stop, rather than a gap.
    """
    raw = driver_laps(session_id, driver)

    df = pd.DataFrame(
        {
            "lap": raw["LapNumber"].astype("Int64"),
            "lap_time_s": raw["LapTime"].map(_seconds),
            "compound": raw.get("Compound"),
            "tyre_life": raw.get("TyreLife"),
            "stint": raw.get("Stint"),
            "track_status": raw.get("TrackStatus").astype(str)
            if "TrackStatus" in raw
            else None,
        }
    )
    df["is_clean"] = raw.apply(_is_clean, axis=1)

    # Rolling median over clean laps only. `center=True` means a lap is compared
    # against its own neighbourhood rather than only its past, so a driver who
    # is slow for the whole stint doesn't drift the baseline down with them.
    clean = df.loc[df["is_clean"], "lap_time_s"]
    baseline = (
        clean.rolling(BASELINE_WINDOW, center=True, min_periods=2)
        .median()
        .reindex(df.index)
        .interpolate(limit_direction="both")
    )

    # Too few clean laps for a rolling window to mean anything — fall back to a
    # flat median rather than emitting noise.
    if clean.count() < BASELINE_WINDOW:
        baseline = pd.Series(clean.median(), index=df.index)

    df["delta_s"] = (df["lap_time_s"] - baseline).round(3)

    out: list[Lap] = []
    for row in df.itertuples(index=False):
        out.append(
            Lap(
                lap=int(row.lap),
                lap_time_s=None if pd.isna(row.lap_time_s) else round(row.lap_time_s, 3),
                delta_s=None if pd.isna(row.delta_s) else float(row.delta_s),
                compound=None if pd.isna(row.compound) else str(row.compound),
                tyre_life=None if pd.isna(row.tyre_life) else int(row.tyre_life),
                stint=None if pd.isna(row.stint) else int(row.stint),
                is_clean=bool(row.is_clean),
                track_status=None if row.track_status is None else str(row.track_status),
            )
        )
    return out


def pace_trend(laps: list[Lap], lap_number: int, window: int = 3) -> float | None:
    """Slope of the pace delta over the `window` laps ending at `lap_number`,
    in seconds per lap.

    Used by the strategy layer: a stress reading only justifies a pit call if
    the driver is *also* losing time. Positive means getting slower.
    """
    recent = [
        l for l in laps if lap_number - window < l.lap <= lap_number and l.delta_s is not None and l.is_clean
    ]
    if len(recent) < 2:
        return None
    x = np.array([l.lap for l in recent], dtype=float)
    y = np.array([l.delta_s for l in recent], dtype=float)
    slope, _ = np.polyfit(x, y, 1)
    return round(float(slope), 4)
