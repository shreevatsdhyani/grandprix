"""Weather and grip.

Two different kinds of number live here and must not be confused.

`AirTemp`, `TrackTemp`, `Rainfall` and friends are *measured* — F1 publishes them
once a minute and we look up the nearest sample. `grip_proxy_s` is *inferred*: the
field's median lap time on a given lap. It moves with rubber-in, rain, safety
cars and red flags alike, so it is only meaningful read next to `rainfall` and the
track status. The field name says `proxy` for that reason.

Track temperature deserves special attention: it swings far more than air
temperature (Silverstone 2024 ranged 20.7-37.9C in one race) and a falling
surface costs front grip, which is exactly the condition that produces
understeer complaints on the radio. `track_temp_delta_from_start_c` exists so a
finding can say "the track had cooled 13 degrees" rather than just quoting an
absolute number an engineer has to hold in their head.
"""

from __future__ import annotations

import logging

import pandas as pd

from app.schemas import TrackConditions, TrackEvolutionPoint

log = logging.getLogger(__name__)


def _nearest(weather: pd.DataFrame, when_rel: pd.Timedelta) -> pd.Series | None:
    """The weather sample closest to a session-relative moment.

    Nearest rather than interpolated: these are one-minute spot readings of
    physically noisy quantities, and interpolating `Rainfall` — a boolean — would
    invent a state that never existed.
    """
    if weather is None or weather.empty or "Time" not in weather:
        return None
    idx = (weather["Time"] - when_rel).abs().idxmin()
    return weather.loc[idx]


def _f(row: pd.Series, key: str) -> float | None:
    if row is None or key not in row or pd.isna(row[key]):
        return None
    return float(row[key])


def conditions_at(
    weather: pd.DataFrame,
    when_rel: pd.Timedelta,
    *,
    track_temp_at_start: float | None = None,
    grip_proxy_s: float | None = None,
) -> TrackConditions:
    """Track conditions at one session-relative moment."""
    row = _nearest(weather, when_rel)
    if row is None:
        return TrackConditions()

    track_temp = _f(row, "TrackTemp")
    rainfall = None
    if "Rainfall" in row and not pd.isna(row["Rainfall"]):
        rainfall = bool(row["Rainfall"])

    delta = None
    if track_temp is not None and track_temp_at_start is not None:
        delta = round(track_temp - track_temp_at_start, 1)

    wind_dir = _f(row, "WindDirection")

    return TrackConditions(
        air_temp_c=_f(row, "AirTemp"),
        track_temp_c=track_temp,
        rainfall=rainfall,
        humidity_pct=_f(row, "Humidity"),
        pressure_hpa=_f(row, "Pressure"),
        wind_speed_ms=_f(row, "WindSpeed"),
        wind_direction_deg=None if wind_dir is None else int(wind_dir),
        track_temp_delta_from_start_c=delta,
        grip_proxy_s=grip_proxy_s,
        # `is_wet` mirrors the sensor rather than second-guessing it. Deriving
        # wetness from lap times instead would double-count the grip proxy.
        is_wet=rainfall,
    )


def track_temp_at_start(weather: pd.DataFrame) -> float | None:
    """Track temperature at the first weather sample of the session."""
    if weather is None or weather.empty or "TrackTemp" not in weather:
        return None
    first = weather.sort_values("Time").iloc[0]["TrackTemp"]
    return None if pd.isna(first) else round(float(first), 1)


def grip_proxy_by_lap(all_laps: pd.DataFrame) -> dict[int, float]:
    """Field median lap time per lap number.

    Median rather than mean: one driver limping to the pits with damage should
    not move the number that stands in for the state of the track.
    """
    if all_laps is None or all_laps.empty:
        return {}
    df = all_laps[["LapNumber", "LapTime"]].dropna()
    if df.empty:
        return {}
    secs = df["LapTime"].dt.total_seconds()
    med = secs.groupby(df["LapNumber"]).median()
    return {int(k): round(float(v), 3) for k, v in med.items() if pd.notna(v)}


def evolution(
    weather: pd.DataFrame, all_laps: pd.DataFrame, lap_start_rel: dict[int, pd.Timedelta]
) -> list[TrackEvolutionPoint]:
    """One row per lap: how the track was changing underneath the whole field."""
    grip = grip_proxy_by_lap(all_laps)
    out: list[TrackEvolutionPoint] = []
    for lap in sorted(lap_start_rel):
        row = _nearest(weather, lap_start_rel[lap])
        rain = None
        if row is not None and "Rainfall" in row and not pd.isna(row["Rainfall"]):
            rain = bool(row["Rainfall"])
        out.append(
            TrackEvolutionPoint(
                lap=lap,
                grip_proxy_s=grip.get(lap),
                track_temp_c=_f(row, "TrackTemp"),
                air_temp_c=_f(row, "AirTemp"),
                rainfall=rain,
            )
        )
    return out


def wet_dry_crossovers(evolution_points: list[TrackEvolutionPoint]) -> list[int]:
    """Laps where the rainfall sensor changed state.

    These are the highest-value laps in a wet race: the crossover is where tyre
    choice decides the result, and where a driver's radio traffic spikes for
    reasons that have nothing to do with fatigue. A findings layer that cannot
    see them will misattribute that stress.
    """
    crossings: list[int] = []
    prev: bool | None = None
    for p in evolution_points:
        if p.rainfall is None:
            continue
        if prev is not None and p.rainfall != prev:
            crossings.append(p.lap)
        prev = p.rainfall
    return crossings
