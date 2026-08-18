"""The competitive picture — flags, position, and gaps.

A stress spike is usually *about* something, and that something is usually
another car or a flag. Without this module a findings layer sees a driver getting
agitated on lap 41 and reaches for fatigue; with it, the driver was lapping four
backmarkers under waved blue flags three seconds after DRS was re-enabled.

Gaps are computed rather than fetched. FastF1's lap frame carries `LapStartTime`
and `LapTime` for every driver, so cumulative elapsed time at the end of a lap
orders the field and differencing it gives the gaps. Verified against 2024
British GP lap 41: HAM leading, NOR +2.338s, VER +5.636s.

One caveat: these are gaps *at the timing line*, not at the moment of the radio
call. A driver can be a second closer mid-lap. Good enough to say "in traffic",
not good enough to quote to three decimals as an instantaneous gap — which is why
`in_traffic` exists as a derived boolean alongside the raw number.
"""

from __future__ import annotations

import logging

import pandas as pd

from app import config
from app.schemas import RaceControlEvent, RaceSituation

log = logging.getLogger(__name__)

# Race-control categories that describe track state rather than admin noise.
FLAG_CATEGORIES = {"Flag", "SafetyCar", "Drs"}


def gaps_at_lap(all_laps: pd.DataFrame, lap_number: int) -> dict[str, dict[str, float | int]]:
    """Position, gap to leader and gap to car ahead for every driver on one lap."""
    if all_laps is None or all_laps.empty:
        return {}
    df = all_laps[all_laps["LapNumber"] == lap_number].copy()
    if df.empty or "LapStartTime" not in df or "LapTime" not in df:
        return {}
    df["elapsed"] = (df["LapStartTime"] + df["LapTime"]).dt.total_seconds()
    df = df[df["elapsed"].notna()].sort_values("elapsed")
    if df.empty:
        return {}
    leader = float(df["elapsed"].iloc[0])
    out: dict[str, dict[str, float | int]] = {}
    prev: float | None = None
    for i, row in enumerate(df.itertuples(index=False), start=1):
        elapsed = float(row.elapsed)
        out[str(row.Driver)] = {
            # Order of arrival at the line, which is the running order. Preferred
            # over the frame's own Position column because that can be NaN on
            # laps where timing dropped a car.
            "position": i,
            "gap_to_leader_s": round(elapsed - leader, 3),
            "gap_ahead_s": None if prev is None else round(elapsed - prev, 3),
        }
        prev = elapsed
    return out


def gaps_all_laps(all_laps: pd.DataFrame) -> dict[int, dict[str, dict[str, float | int]]]:
    """Position and gaps for every driver on every lap, in one pass.

    `gaps_at_lap` filters and sorts per lap, which is fine for a single lookup and
    wasteful for a whole session — the timeline needs all 78 laps of Monaco on every
    request. This does the elapsed-time computation once and groups afterwards.

    Returns `{lap: {driver: {position, gap_to_leader_s, gap_ahead_s}}}`.
    """
    if all_laps is None or all_laps.empty:
        return {}
    need = {"LapNumber", "Driver", "LapStartTime", "LapTime"}
    if not need.issubset(all_laps.columns):
        return {}

    df = all_laps[list(need)].copy()
    # Coerce both columns rather than trusting their dtype. A frame whose LapTime is
    # entirely unset — every driver retired, or a session that never ran green —
    # comes back as object dtype, and `.dt` on that raises AttributeError instead of
    # yielding NaT. Coercing first turns a crash into an empty result.
    # `to_timedelta` still raises on an all-NaT object column, so the conversion is
    # wrapped rather than merely coerced. Any frame we cannot read as timings yields
    # no gaps, which is the honest answer and never an exception on a request path.
    try:
        start = pd.to_timedelta(df["LapStartTime"], errors="coerce")
        duration = pd.to_timedelta(df["LapTime"], errors="coerce")
        df["elapsed"] = (start + duration).dt.total_seconds()
    except (TypeError, ValueError) as exc:
        log.warning("lap timings unreadable, no gaps computed: %s", exc)
        return {}
    df = df[df["elapsed"].notna() & df["LapNumber"].notna()]
    if df.empty:
        return {}

    out: dict[int, dict[str, dict[str, float | int]]] = {}
    for lap, g in df.sort_values("elapsed").groupby("LapNumber"):
        lap_no = int(lap)
        leader = float(g["elapsed"].iloc[0])
        per_driver: dict[str, dict[str, float | int]] = {}
        prev: float | None = None
        for i, row in enumerate(g.itertuples(index=False), start=1):
            elapsed = float(row.elapsed)
            per_driver[str(row.Driver)] = {
                "position": i,
                "gap_to_leader_s": round(elapsed - leader, 3),
                "gap_ahead_s": None if prev is None else round(elapsed - prev, 3),
            }
            prev = elapsed
        out[lap_no] = per_driver
    return out


def flags_by_lap(race_control: pd.DataFrame) -> dict[int, list[str]]:
    """Distinct flags mentioned per lap, from the race-control feed.

    Lap-scoped rather than time-scoped, because the per-lap view has no instant to
    anchor a window to. Race control's own `Lap` column is used as given.
    """
    if race_control is None or race_control.empty or "Lap" not in race_control:
        return {}
    out: dict[int, list[str]] = {}
    for row in race_control.itertuples(index=False):
        lap = getattr(row, "Lap", None)
        flag = getattr(row, "Flag", None)
        if lap is None or pd.isna(lap) or flag is None or pd.isna(flag):
            continue
        flag = str(flag)
        if flag.upper() == "NONE":
            continue
        bucket = out.setdefault(int(lap), [])
        if flag not in bucket:
            bucket.append(flag)
    return out


def nearby_messages(
    race_control: pd.DataFrame, when_utc: pd.Timestamp, window_s: int | None = None
) -> list[RaceControlEvent]:
    """Race-control messages within a window either side of a moment."""
    if race_control is None or race_control.empty or "Time" not in race_control:
        return []
    window = config.RACE_CONTROL_WINDOW_S if window_s is None else window_s
    rc = race_control.copy()
    rc["abs"] = pd.to_datetime(rc["Time"], errors="coerce")
    if rc["abs"].dt.tz is not None:
        rc["abs"] = rc["abs"].dt.tz_localize(None)
    lo = when_utc - pd.Timedelta(seconds=window)
    hi = when_utc + pd.Timedelta(seconds=window)
    near = rc[(rc["abs"] >= lo) & (rc["abs"] <= hi)].sort_values("abs")

    out: list[RaceControlEvent] = []
    for row in near.itertuples(index=False):
        lap = getattr(row, "Lap", None)
        out.append(
            RaceControlEvent(
                utc=row.abs.isoformat(),
                lap=None if lap is None or pd.isna(lap) else int(lap),
                category=None if pd.isna(getattr(row, "Category", None)) else str(row.Category),
                flag=None if pd.isna(getattr(row, "Flag", None)) else str(row.Flag),
                scope=None if pd.isna(getattr(row, "Scope", None)) else str(row.Scope),
                message=str(getattr(row, "Message", "")),
                offset_s=round((row.abs - when_utc).total_seconds(), 1),
            )
        )
    return out


def active_flags(events: list[RaceControlEvent]) -> list[str]:
    """Distinct flags mentioned in the window, most recent first.

    Not a claim that each flag was still flying at the instant — race control does
    not publish clear-downs reliably enough for that. It is "these are the flags
    in play around this moment", which is what an engineer actually wants.
    """
    seen: list[str] = []
    for e in sorted(events, key=lambda x: abs(x.offset_s)):
        if e.flag and e.flag.upper() not in ("NONE",) and e.flag not in seen:
            seen.append(e.flag)
    return seen


def situation_at(
    all_laps: pd.DataFrame,
    race_control: pd.DataFrame,
    driver: str,
    lap_number: int,
    when_utc: pd.Timestamp,
    track_status: str | None = None,
) -> RaceSituation:
    """The competitive picture for one driver at one moment."""
    gaps = gaps_at_lap(all_laps, lap_number).get(driver.upper(), {})
    events = nearby_messages(race_control, when_utc)
    gap_ahead = gaps.get("gap_ahead_s")
    flags = active_flags(events)

    # Two independent routes to "in traffic", because the gap alone misses the
    # commonest case. The race leader has no car ahead and so no gap at all, yet
    # spends much of a race picking through backmarkers — and that traffic is
    # exactly what produces terse, irritated radio. Waved blue flags are the
    # signal for it.
    in_traffic: bool | None = None
    if gap_ahead is not None:
        in_traffic = bool(gap_ahead <= config.IN_TRAFFIC_GAP_S)
    if "BLUE" in flags:
        in_traffic = True

    return RaceSituation(
        position=gaps.get("position"),
        gap_ahead_s=gap_ahead,
        gap_to_leader_s=gaps.get("gap_to_leader_s"),
        track_status=track_status,
        active_flags=flags,
        nearby_messages=events,
        in_traffic=in_traffic,
    )
