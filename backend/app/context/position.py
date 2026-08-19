"""Where on the lap the car was, and what it was doing there.

This is the module that turns "stress spiked on lap 41" into "stress spiked on
the exit of Turn 18 at 260kph, full throttle, seventh gear" — the difference
between a chart and a debrief.

How it works: `add_distance()` integrates speed to give distance travelled along
the lap, and `get_circuit_info().corners` gives each numbered turn's distance from
the start line. Match a UTC instant to the nearest telemetry sample, read its
distance, and the nearest corner falls out.

We match on the telemetry frame's `Date` column, which is absolute UTC. This is
worth being explicit about, because a lap-scoped telemetry frame carries *three*
time columns and only one of them means what you would guess:

    Date         absolute UTC                  <- what we match on
    SessionTime  offset from session start
    Time         offset from THIS LAP's start  <- resets to zero every lap

Matching a session-relative instant against `Time` silently clamps every lookup
to the last sample of the lap, which reads as a plausible answer (a real corner,
a real speed) while being wrong for every clip. Hence the explicit span check
below: outside the frame's own window we return nothing rather than the nearest
edge.

Two accuracy caveats worth stating rather than burying:

- Distance is integrated from speed, so it accumulates a small error over a lap.
  Good to a few metres near the start line, tens of metres by the end. Fine for
  "which corner", not for "which kerb".
- The instant a radio call is *published* is not the instant the driver *spoke*.
  The offset is small but real, so a call resolving to a corner exit may have
  started at the entry. Findings should say "around Turn 18", not "at the apex".
"""

from __future__ import annotations

import logging

import pandas as pd

from app import config
from app.schemas import TrackPosition

log = logging.getLogger(__name__)


def _zone(speed: float | None, throttle: float | None, brake: bool | None, corner_dist: float | None) -> str:
    """A coarse label for what kind of place on the track this is.

    Deliberately coarse. The point is to let a finding say "in a braking zone"
    rather than to reconstruct a driving trace.
    """
    if brake:
        return "braking"
    # Speed is tested before corner proximity on purpose. Several circuits have
    # numbered turns that are flat in top gear — Silverstone's Chapel, Monza's
    # Curva Grande — and calling 290kph "in a corner" tells an engineer nothing.
    # If the car is fast it is on a fast bit of track, whatever the map says.
    if speed is not None and speed >= config.HIGH_SPEED_MIN_KPH:
        return "high_speed"
    if corner_dist is not None and abs(corner_dist) <= config.CORNER_PROXIMITY_M:
        return "corner"
    # A car under 80kph on a lap that is not a corner or a braking zone is almost
    # always in the pit lane (limiter is 80kph in races).
    if speed is not None and speed < 80 and (throttle is None or throttle < 50):
        return "pit_lane"
    return "other"


def _sector_for(lap: pd.Series, when_rel: pd.Timedelta) -> int | None:
    """Which sector the car was in, from the sector session-time boundaries."""
    s1 = lap.get("Sector1SessionTime")
    s2 = lap.get("Sector2SessionTime")
    if pd.notna(s1) and when_rel <= s1:
        return 1
    if pd.notna(s2) and when_rel <= s2:
        return 2
    if pd.notna(s2):
        return 3
    return None


def _utc_column(car_data: pd.DataFrame) -> pd.Series | None:
    """The telemetry frame's absolute-UTC column, timezone-naive."""
    if "Date" not in car_data:
        return None
    d = car_data["Date"]
    if getattr(d.dt, "tz", None) is not None:
        d = d.dt.tz_localize(None)
    return d


def position_at(
    lap_row: pd.Series,
    car_data: pd.DataFrame,
    corners: pd.DataFrame,
    when_rel: pd.Timedelta,
    when_utc: pd.Timestamp,
) -> TrackPosition:
    """Intra-lap position and telemetry at one instant.

    `car_data` must already have `add_distance()` applied and be scoped to this
    lap. `corners` is `get_circuit_info().corners`. `when_rel` is used only for
    the sector, which is derived from session-relative boundaries.
    """
    sector = _sector_for(lap_row, when_rel)
    if car_data is None or car_data.empty:
        return TrackPosition(sector=sector)

    utc = _utc_column(car_data)
    if utc is None or utc.isna().all():
        return TrackPosition(sector=sector)

    # Refuse to answer outside the frame's own window. Clamping here would return
    # the lap's first or last sample dressed up as a real reading.
    if not (utc.min() <= when_utc <= utc.max()):
        log.debug(
            "instant %s outside telemetry span %s..%s", when_utc, utc.min(), utc.max()
        )
        return TrackPosition(sector=sector, lap_length_m=round(float(car_data["Distance"].max()), 1)
                             if "Distance" in car_data else None)

    idx = (utc - when_utc).abs().idxmin()
    row = car_data.loc[idx]

    def num(key: str) -> float | None:
        if key not in row or pd.isna(row[key]):
            return None
        return float(row[key])

    dist = num("Distance")
    lap_len = None
    if "Distance" in car_data:
        lap_len = round(float(car_data["Distance"].max()), 1)

    nearest_corner = None
    to_corner = None
    if dist is not None and corners is not None and not corners.empty:
        c = corners.iloc[(corners["Distance"] - dist).abs().argsort()[:1]]
        nearest_corner = int(c["Number"].iloc[0])
        # Signed so a finding can distinguish approach from exit: negative means
        # the corner is already behind the car.
        to_corner = round(float(c["Distance"].iloc[0]) - dist, 1)

    speed = num("Speed")
    throttle = num("Throttle")
    brake_raw = num("Brake")
    brake = None if brake_raw is None else brake_raw > config.BRAKING_ZONE_MIN_BRAKE
    gear = num("nGear")
    rpm = num("RPM")
    drs = num("DRS")

    pct = None
    if dist is not None and lap_len:
        pct = round(100.0 * dist / lap_len, 1)

    return TrackPosition(
        distance_into_lap_m=None if dist is None else round(dist, 1),
        lap_length_m=lap_len,
        pct_of_lap=pct,
        nearest_corner=nearest_corner,
        distance_to_corner_m=to_corner,
        sector=sector,
        speed_kph=speed,
        throttle_pct=throttle,
        brake=brake,
        gear=None if gear is None else int(gear),
        rpm=None if rpm is None else int(rpm),
        # DRS codes 10/12/14 mean open; 0/1/8 mean closed. Anything >= 10 is on.
        drs_active=None if drs is None else drs >= 10,
        zone=_zone(speed, throttle, brake, to_corner),
    )
