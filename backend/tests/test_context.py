"""Tests for the race-context layer.

The anchor case is Hamilton's lap-41 radio call from the 2024 British Grand Prix,
chosen because every domain has real data there and because the correct answer was
verified by hand against the FastF1 cache: lap 41, P1, four-lap-old softs, 2492m
into the lap approaching Turn 8 at 264kph, track 24.2C having cooled from a 37.9C
peak, blue flags out for backmarkers.

These tests read the cached session, so they need `scripts/cache_sessions.py` to
have run. They are skipped rather than failed when the cache is absent, because a
missing 550MB cache is an environment problem, not a regression.
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.context import resolver, situation as situation_mod, track as track_mod, tyre as tyre_mod

SESSION = "2024-british-r"
# Hamilton's radio at this instant is clip 2024-british-r-HAM-160752. The UTC comes
# from OpenF1's team_radio record for the matching live-timing filename.
HAM_LAP41_UTC = pd.Timestamp("2024-07-07T15:08:25.385")


@pytest.fixture(scope="module")
def frames():
    fastf1_client = pytest.importorskip("app.data.fastf1_client")
    from app.context import frames as frames_mod

    try:
        session = fastf1_client.load_session_full(SESSION)
    except Exception as exc:  # pragma: no cover - environment, not logic
        pytest.skip(f"session cache unavailable: {exc}")
    return frames_mod.from_session(session, SESSION)


# --- the anchor case ------------------------------------------------------


def test_resolves_lap_from_utc(frames):
    assert resolver.lap_at(frames, "HAM", HAM_LAP41_UTC) == 41


def test_resolves_full_context(frames):
    ctx = resolver.resolve_at(frames, "HAM", HAM_LAP41_UTC, clip_id="test")

    assert ctx.lap == 41
    assert ctx.phase == "racing"

    assert ctx.track is not None
    assert ctx.track.track_temp_c == pytest.approx(24.2, abs=0.3)
    assert ctx.track.rainfall is False
    # The surface had cooled since the start; the sign is the point.
    assert ctx.track.track_temp_delta_from_start_c is not None
    assert ctx.track.track_temp_delta_from_start_c < 0

    assert ctx.tyre is not None
    assert ctx.tyre.compound == "SOFT"
    assert ctx.tyre.tyre_age_laps == 4
    assert ctx.tyre.stint_number == 3
    # Never negotiable: this is the flag that stops the UI implying a measurement.
    assert ctx.tyre.basis == "modelled"

    assert ctx.position is not None
    assert ctx.position.distance_into_lap_m == pytest.approx(2492, abs=60)
    assert ctx.position.nearest_corner == 8
    assert ctx.position.sector == 2
    assert ctx.position.speed_kph == pytest.approx(264, abs=8)

    assert ctx.situation is not None
    assert ctx.situation.position == 1
    assert "BLUE" in ctx.situation.active_flags
    # Leading while lapping backmarkers still counts as traffic.
    assert ctx.situation.in_traffic is True

    # No biometrics have been uploaded, and absent must mean absent.
    assert ctx.biometrics is None


# --- the bug this layer was built around ---------------------------------


def test_post_race_radio_is_not_attributed_to_the_final_lap(frames):
    """Hamilton's victory radio must not inherit lap 52's tyre and gap data.

    The naive "last lap whose start has passed" answer returns a real lap number
    that looks entirely plausible, which is exactly why this needs a test.
    """
    # 15:29:55 UTC — after the chequered flag at ~15:27.
    ctx = resolver.resolve_at(frames, "HAM", pd.Timestamp("2024-07-07T15:29:55.120"))

    assert ctx.lap is None
    assert ctx.phase == "post_race"
    assert ctx.tyre is None
    assert ctx.position is None
    # Weather is session-wide, so it is still known and still useful.
    assert ctx.track is not None
    assert ctx.track.track_temp_c is not None


def test_grid_radio_is_not_attributed_to_lap_one(frames):
    """Pre-race nerves are not lap-1 racing stress."""
    ctx = resolver.resolve_at(frames, "LEC", pd.Timestamp("2024-07-07T13:22:02.763"))

    assert ctx.lap is None
    assert ctx.phase == "pre_race"
    assert ctx.tyre is None


def test_telemetry_lookup_outside_the_lap_returns_nothing_rather_than_clamping(frames):
    """A position lookup must refuse, not return the nearest edge sample.

    FastF1's lap-scoped telemetry frame carries three time columns and only `Date`
    is absolute; matching on the wrong one silently clamps every lookup to the last
    sample of the lap, producing a real corner and a real speed that are wrong for
    every clip. That failure is invisible without this test.
    """
    from app.context import position as position_mod

    laps = frames.all_laps
    row = laps[(laps["Driver"] == "HAM") & (laps["LapNumber"] == 41)].iloc[0]
    car = row.get_car_data(interpolate_edges=True).add_distance()

    # An instant an hour later cannot be on this lap.
    pos = position_mod.position_at(
        row, car, frames.corners, pd.Timedelta(hours=9), HAM_LAP41_UTC + pd.Timedelta(hours=1)
    )
    assert pos.nearest_corner is None
    assert pos.speed_kph is None


# --- domain builders in isolation ----------------------------------------


def test_wet_dry_crossovers_detect_state_changes_only():
    from app.schemas import TrackEvolutionPoint

    evo = [
        TrackEvolutionPoint(lap=1, rainfall=False),
        TrackEvolutionPoint(lap=2, rainfall=False),
        TrackEvolutionPoint(lap=3, rainfall=True),  # dry -> wet
        TrackEvolutionPoint(lap=4, rainfall=True),
        TrackEvolutionPoint(lap=5, rainfall=False),  # wet -> dry
    ]
    assert track_mod.wet_dry_crossovers(evo) == [3, 5]


def test_crossovers_ignore_missing_readings():
    """A gap in the sensor is not a change of state."""
    from app.schemas import TrackEvolutionPoint

    evo = [
        TrackEvolutionPoint(lap=1, rainfall=False),
        TrackEvolutionPoint(lap=2, rainfall=None),
        TrackEvolutionPoint(lap=3, rainfall=False),
    ]
    assert track_mod.wet_dry_crossovers(evo) == []


def test_deg_slope_needs_enough_clean_laps():
    """Two points make a line but not an inference."""
    df = pd.DataFrame(
        {
            "LapNumber": [1, 2],
            "TyreLife": [1, 2],
            "LapTime": pd.to_timedelta([90.0, 90.3], unit="s"),
            "PitInTime": [pd.NaT, pd.NaT],
            "PitOutTime": [pd.NaT, pd.NaT],
            "TrackStatus": ["1", "1"],
        }
    )
    assert tyre_mod.deg_slope(df) is None


def test_deg_slope_measures_seconds_per_lap_of_tyre_age():
    n = 8
    df = pd.DataFrame(
        {
            "LapNumber": range(1, n + 1),
            "TyreLife": range(1, n + 1),
            # Exactly 0.1s per lap of age.
            "LapTime": pd.to_timedelta([90.0 + 0.1 * i for i in range(n)], unit="s"),
            "PitInTime": [pd.NaT] * n,
            "PitOutTime": [pd.NaT] * n,
            "TrackStatus": ["1"] * n,
        }
    )
    assert tyre_mod.deg_slope(df) == pytest.approx(0.1, abs=0.001)


def test_deg_slope_excludes_pit_and_non_green_laps():
    """A 20-second pit lap says nothing about a tyre."""
    n = 8
    times = [90.0 + 0.1 * i for i in range(n)]
    times[3] = 115.0  # pit lap
    df = pd.DataFrame(
        {
            "LapNumber": range(1, n + 1),
            "TyreLife": range(1, n + 1),
            "LapTime": pd.to_timedelta(times, unit="s"),
            "PitInTime": [pd.NaT if i != 3 else pd.Timestamp("2024-01-01") for i in range(n)],
            "PitOutTime": [pd.NaT] * n,
            "TrackStatus": ["1"] * n,
        }
    )
    # Without the exclusion the outlier would drag the slope well off 0.1.
    assert tyre_mod.deg_slope(df) == pytest.approx(0.1, abs=0.01)


def test_gaps_order_the_field_and_difference_correctly():
    """Verified against 2024 British GP lap 41: HAM led, NOR +2.338, VER +5.636."""
    df = pd.DataFrame(
        {
            "Driver": ["NOR", "HAM", "VER"],
            "LapNumber": [41, 41, 41],
            "LapStartTime": pd.to_timedelta([0, 0, 0], unit="s"),
            "LapTime": pd.to_timedelta([102.338, 100.0, 105.636], unit="s"),
        }
    )
    gaps = situation_mod.gaps_at_lap(df, 41)

    assert gaps["HAM"]["position"] == 1
    assert gaps["HAM"]["gap_to_leader_s"] == 0.0
    assert gaps["HAM"]["gap_ahead_s"] is None  # nobody ahead of the leader

    assert gaps["NOR"]["position"] == 2
    assert gaps["NOR"]["gap_to_leader_s"] == pytest.approx(2.338)
    assert gaps["VER"]["gap_to_leader_s"] == pytest.approx(5.636)
    assert gaps["VER"]["gap_ahead_s"] == pytest.approx(3.298)
