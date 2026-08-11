"""Turning stress readings into pit-wall decisions.

The brief's theme is "Racing Strategy & Decision-Making", so the product must
not stop at a mood label. This module is where analysis becomes an instruction a
race engineer could act on.

Deliberately deterministic thresholds, not a language model. A pit wall needs
the same input to produce the same call every time, and an engineer must be able
to ask "why did it say that?" and get an answer that is a rule, not a vibe.

The most important rule here is HOLD: a stress spike with no pace loss means the
driver is venting and the strategy should NOT change. Knowing when *not* to act
is most of race strategy, and a system that only ever escalates is a system the
pit wall learns to ignore.
"""

from __future__ import annotations

from app.data.laps import pace_trend
from app.schemas import Lap, Mood, StrategyCall, Urgency

# --- thresholds -----------------------------------------------------------
# Tuned to be legible rather than clever; every one is a number an engineer
# could argue with, which is the point.

STRESS_ELEVATED = 60.0  # stress index above which a call may fire
SUSTAINED_LAPS = 3  # consecutive elevated readings for "confirmed"
PACE_WORSENING = 0.03  # s/lap slope that counts as genuinely losing time
PACE_STABLE = 0.02  # slope below which pace is considered unaffected
RADIO_BURST_WINDOW = 6  # laps
RADIO_BURST_COUNT = 3  # calls within that window = saturated


def _consecutive_elevated(readings: list[tuple[int, float]], upto: int) -> int:
    """How many consecutive radio calls up to and including `upto` were elevated."""
    run = 0
    for lap, stress in readings:
        if lap > upto:
            break
        run = run + 1 if stress >= STRESS_ELEVATED else 0
    return run


def evaluate(
    readings: list[tuple[int, float, Mood]],
    laps: list[Lap],
    median_stint: float | None = None,
) -> list[StrategyCall]:
    """Produce strategy calls for one driver's session.

    `readings` is (lap, stress_index, mood) per radio call, in lap order.
    """
    calls: list[StrategyCall] = []
    if not readings:
        return calls

    readings = sorted(readings, key=lambda r: r[0])
    stress_only = [(lap, stress) for lap, stress, _ in readings]
    lap_index = {l.lap: l for l in laps}

    for lap, stress, mood in readings:
        trend = pace_trend(laps, lap)
        run = _consecutive_elevated(stress_only, lap)
        elevated = stress >= STRESS_ELEVATED

        # --- HOLD: the call that says do nothing --------------------------
        # High stress, but the driver is not actually losing time. Changing
        # strategy here costs track position for no reason.
        if elevated and trend is not None and trend < PACE_STABLE:
            calls.append(
                StrategyCall(
                    lap=lap,
                    code="HOLD",
                    headline="HOLD — driver venting, pace unaffected",
                    rationale=(
                        f"Stress {stress:.0f}/100 but pace trend {trend:+.2f}s/lap. "
                        "No performance loss. Do not re-plan the stop."
                    ),
                    urgency=Urgency.INFO,
                )
            )
            continue

        # --- BOX NOW: stress sustained AND pace collapsing ----------------
        if run >= SUSTAINED_LAPS and trend is not None and trend >= PACE_WORSENING:
            calls.append(
                StrategyCall(
                    lap=lap,
                    code="BOX_NOW",
                    headline="BOX THIS LAP — driver degradation confirmed",
                    rationale=(
                        f"Stress elevated {run} consecutive calls and pace worsening "
                        f"{trend:+.2f}s/lap."
                    ),
                    urgency=Urgency.CRITICAL,
                )
            )
            continue

        # --- PIT WINDOW: fatigue ahead of the tyre cliff ------------------
        stint = lap_index.get(lap)
        long_stint = (
            median_stint is not None
            and stint is not None
            and stint.tyre_life is not None
            and stint.tyre_life > median_stint
        )
        if mood is Mood.TIRED and elevated and long_stint:
            calls.append(
                StrategyCall(
                    lap=lap,
                    code="PIT_WINDOW_OPENING",
                    headline="PIT WINDOW OPENING — fatigue ahead of tyre cliff",
                    rationale=(
                        f"Fatigue markers with {stint.tyre_life} laps on this set, "
                        f"above this driver's median stint of {median_stint:.0f}."
                    ),
                    urgency=Urgency.WARNING,
                )
            )
            continue

        if elevated:
            calls.append(
                StrategyCall(
                    lap=lap,
                    code="MONITOR",
                    headline="MONITOR — stress rising",
                    rationale=f"Stress {stress:.0f}/100, single elevated reading.",
                    urgency=Urgency.INFO,
                )
            )

    # --- radio saturation: a whole-session pattern, not a per-lap one -----
    for lap, _, _ in readings:
        window = [l for l, s, _ in readings if lap - RADIO_BURST_WINDOW < l <= lap and s >= STRESS_ELEVATED]
        if len(window) >= RADIO_BURST_COUNT:
            if not any(c.code == "REDUCE_RADIO_LOAD" for c in calls):
                calls.append(
                    StrategyCall(
                        lap=lap,
                        code="REDUCE_RADIO_LOAD",
                        headline="REDUCE RADIO LOAD — driver is saturated",
                        rationale=(
                            f"{len(window)} elevated calls within {RADIO_BURST_WINDOW} laps."
                        ),
                        urgency=Urgency.WARNING,
                    )
                )
            break

    return sorted(calls, key=lambda c: c.lap)


def median_stint_length(laps: list[Lap]) -> float | None:
    """This driver's typical stint, used to judge whether the current one is long."""
    lengths: dict[int, int] = {}
    for l in laps:
        if l.stint is not None:
            lengths[l.stint] = lengths.get(l.stint, 0) + 1
    if not lengths:
        return None
    values = sorted(lengths.values())
    mid = len(values) // 2
    return float(values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2)
