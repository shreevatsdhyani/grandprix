"""Does the voice lead the stopwatch?

The brief asks for a visual showing whether mood is *affecting* lap performance
— a relationship, not two charts side by side. This module computes it.

We cross-correlate the stress series against the pace-delta series at a range of
lap offsets. A negative peak lag means stress moved first, which would make the
signal predictive rather than merely descriptive.

The honesty rules are enforced here rather than left to the UI:
  * pairs are only formed on clean laps,
  * a lag is only scored if enough pairs survive,
  * `is_significant` is False below the configured sample floor, and the
    interpretation string says so in words.

With ~100 clips this is indicative, not conclusive. Overclaiming it would cost
more credibility than the finding is worth.
"""

from __future__ import annotations

import math

from app import config
from app.schemas import Lap, LeadLagAnalysis, LeadLagPoint

MIN_PAIRS = 4  # below this a correlation coefficient is meaningless


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < MIN_PAIRS:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    dx = [x - mx for x in xs]
    dy = [y - my for y in ys]
    num = sum(a * b for a, b in zip(dx, dy))
    den = math.sqrt(sum(a * a for a in dx) * sum(b * b for b in dy))
    if den == 0:  # a flat series has no correlation to report
        return None
    return num / den


def compute(
    stress_by_lap: dict[int, float],
    laps: list[Lap],
    lag_range=config.LEAD_LAG_RANGE,
) -> LeadLagAnalysis | None:
    """Correlate stress at lap L against pace delta at lap L - lag.

    A lag of -2 pairs stress on lap 40 with pace on lap 42, so a high
    correlation there means stress preceded the pace loss by two laps.
    """
    if not stress_by_lap:
        return None

    # Only clean laps carry a usable pace signal: a pit lap is +20s regardless
    # of how the driver sounds, and would manufacture correlation.
    delta_by_lap = {l.lap: l.delta_s for l in laps if l.is_clean and l.delta_s is not None}
    if not delta_by_lap:
        return None

    curve: list[LeadLagPoint] = []
    for lag in lag_range:
        xs, ys = [], []
        for lap, stress in stress_by_lap.items():
            target = lap - lag
            if target in delta_by_lap:
                xs.append(stress)
                ys.append(delta_by_lap[target])
        r = _pearson(xs, ys)
        curve.append(
            LeadLagPoint(
                lag_laps=lag,
                correlation=round(r, 3) if r is not None else None,
                n_pairs=len(xs),
            )
        )

    # Pick the peak among *measured* lags only. Coercing an unmeasurable lag to
    # 0.0 and then taking max() meant that when every measurable offset came back
    # negative — entirely possible, a driver can sound worst on his fastest laps
    # — the winner was a lag with no data behind it, and the headline read
    # "stress peaks N laps before pace loss (r = 0.00)". A claim manufactured
    # from missing data is the one failure mode this panel cannot survive.
    measured = [p for p in curve if p.correlation is not None]
    if not measured:
        return None

    peak = max(measured, key=lambda p: p.correlation)
    n = len(stress_by_lap)
    significant = n >= config.MIN_SAMPLES_FOR_SIGNIFICANCE and peak.correlation > 0

    if peak.correlation <= 0:
        # Even the best offset shows no positive relationship. Saying so is the
        # whole point of measuring: the alternative is to narrate a lag as if it
        # were a finding when the data refused to produce one.
        headline = (
            f"No positive stress-to-pace relationship at any offset in "
            f"±{max(abs(l) for l in lag_range)} laps "
            f"(best r = {peak.correlation:.2f} at {peak.lag_laps:+d})."
        )
    elif peak.lag_laps < 0:
        headline = (
            f"Voice stress peaks about {abs(peak.lag_laps)} lap"
            f"{'s' if abs(peak.lag_laps) != 1 else ''} before pace loss "
            f"(r = {peak.correlation:.2f})."
        )
    elif peak.lag_laps == 0:
        headline = f"Voice stress moves with pace loss, not ahead of it (r = {peak.correlation:.2f})."
    else:
        headline = (
            f"Voice stress follows pace loss by {peak.lag_laps} lap"
            f"{'s' if peak.lag_laps != 1 else ''} (r = {peak.correlation:.2f}), "
            "so it reacts rather than predicts."
        )

    qualifier = (
        f" Indicative only — {n} clips in this session."
        if not significant
        else f" Based on {n} clips."
    )

    return LeadLagAnalysis(
        curve=curve,
        peak_lag_laps=peak.lag_laps,
        peak_correlation=peak.correlation,
        n_samples=n,
        interpretation=headline + qualifier,
        is_significant=significant,
    )
