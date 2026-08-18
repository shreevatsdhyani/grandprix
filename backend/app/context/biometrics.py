"""Driver biometrics — an optional second stress channel.

The stress signal in this app comes from voice. Biometrics would be an
*independent* channel, which is why the ingestion path is worth building: two
signals agreeing is evidence, one signal is a hypothesis.

We have no real data. That shapes every decision here:

- Nothing is ever synthesised. No file means `None`, and the UI says "no
  biometric data" rather than drawing a flat line at zero. A fabricated heart
  rate sitting next to a measured track temperature is indistinguishable from a
  measurement, and this codebase's honesty flags (`MoodResult.fitted`,
  `TyreState.basis`) all fail closed for exactly that reason.
- Z-scores use the driver's own session baseline, matching the prosody branch's
  convention in `pipeline/baseline.py`. Absolute heart rate says more about the
  athlete than the moment; deviation from their own resting-in-car baseline is
  the signal.

Accepted input is a CSV or JSON array with a timestamp column plus any of
`hr_bpm`, `hrv_ms`, `core_temp_c`. Timestamps may be ISO 8601 (UTC assumed if
naive) or epoch seconds.

On alignment: biometric sensors typically sample at 1Hz while car telemetry runs
near 4Hz, so we resolve to the nearest sample rather than interpolating, and
tolerate a gap of up to `MAX_ALIGN_GAP_S` before reporting no reading. Note also
that heart rate lags a stressor by several seconds physiologically — this module
does not attempt to correct for that, so a reading aligned to a radio call
reflects the seconds just before it as much as the moment itself.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import statistics

import pandas as pd

from app.schemas import BiometricPoint, BiometricSeries

log = logging.getLogger(__name__)

TIME_KEYS = ("utc", "timestamp", "time", "ts", "datetime", "date")
# Beyond this, "nearest sample" stops being an alignment and starts being a guess.
MAX_ALIGN_GAP_S = 5.0


class BiometricParseError(ValueError):
    """Raised with a message intended to be shown to the uploader verbatim."""


def _parse_time(raw: object) -> pd.Timestamp | None:
    if raw is None or raw == "":
        return None
    try:
        # Epoch seconds arrive from most wearable exports.
        val = float(raw)
        return pd.to_datetime(val, unit="s")
    except (TypeError, ValueError):
        pass
    ts = pd.to_datetime(str(raw), errors="coerce", utc=False)
    if ts is pd.NaT or pd.isna(ts):
        return None
    if getattr(ts, "tz", None) is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return ts


def _num(raw: object) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(v) else v


def parse(raw: bytes | str, *, source: str) -> list[dict]:
    """Parse an uploaded biometric file into normalised row dicts.

    Accepts CSV or a JSON array. Rows with an unparseable timestamp are skipped;
    if that leaves nothing, we raise rather than return an empty series, because
    "upload succeeded, zero samples" reads as a working feature.
    """
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
    text = text.strip()
    if not text:
        raise BiometricParseError("File is empty.")

    records: list[dict]
    if text[0] in "[{":
        try:
            loaded = json.loads(text)
        except json.JSONDecodeError as exc:
            raise BiometricParseError(f"Not valid JSON: {exc.msg} at line {exc.lineno}") from exc
        records = loaded if isinstance(loaded, list) else loaded.get("samples", [])
        if not isinstance(records, list):
            raise BiometricParseError("JSON must be an array of samples, or an object with a 'samples' array.")
    else:
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise BiometricParseError("CSV has no header row.")
        records = list(reader)

    lowered = [{(k or "").strip().lower(): v for k, v in r.items()} for r in records]
    time_key = next((k for k in TIME_KEYS if lowered and k in lowered[0]), None)
    if time_key is None:
        raise BiometricParseError(
            f"No timestamp column found. Expected one of: {', '.join(TIME_KEYS)}."
        )

    rows: list[dict] = []
    for r in lowered:
        ts = _parse_time(r.get(time_key))
        if ts is None:
            continue
        rows.append(
            {
                "utc": ts,
                "hr_bpm": _num(r.get("hr_bpm") or r.get("hr") or r.get("heart_rate")),
                "hrv_ms": _num(r.get("hrv_ms") or r.get("hrv") or r.get("rmssd")),
                "core_temp_c": _num(r.get("core_temp_c") or r.get("core_temp") or r.get("temp")),
            }
        )
    if not rows:
        raise BiometricParseError(
            "No rows had a readable timestamp. Expected ISO 8601 (e.g. 2024-07-07T15:08:25Z) or epoch seconds."
        )
    rows.sort(key=lambda r: r["utc"])
    return rows


def build_series(
    rows: list[dict],
    *,
    driver: str,
    session_id: str,
    source: str,
    lap_for_utc=None,
) -> BiometricSeries:
    """Z-score against the driver's own baseline and attach lap numbers.

    `lap_for_utc` is an optional callable mapping a timestamp to a lap number, so
    this module needs no knowledge of how laps are resolved.
    """
    hrs = [r["hr_bpm"] for r in rows if r["hr_bpm"] is not None]
    hr_mean = statistics.fmean(hrs) if hrs else None
    # A single sample has no spread; guard so the z-score is None rather than a
    # division by zero dressed up as certainty.
    hr_sd = statistics.stdev(hrs) if len(hrs) > 1 else None

    hrvs = [r["hrv_ms"] for r in rows if r["hrv_ms"] is not None]
    hrv_mean = statistics.fmean(hrvs) if hrvs else None
    hrv_sd = statistics.stdev(hrvs) if len(hrvs) > 1 else None

    samples: list[BiometricPoint] = []
    for r in rows:
        hr, hrv = r["hr_bpm"], r["hrv_ms"]
        samples.append(
            BiometricPoint(
                utc=r["utc"].isoformat(),
                lap=lap_for_utc(r["utc"]) if lap_for_utc else None,
                hr_bpm=hr,
                hrv_ms=hrv,
                core_temp_c=r["core_temp_c"],
                hr_z=None if (hr is None or not hr_sd) else round((hr - hr_mean) / hr_sd, 2),
                hrv_z=None if (hrv is None or not hrv_sd) else round((hrv - hrv_mean) / hrv_sd, 2),
            )
        )

    note = None
    if hr_sd is None and hrs:
        note = "Only one heart-rate sample, so no baseline deviation could be computed."
    elif not hrs:
        note = "No heart-rate values in this upload; only the columns present are shown."

    return BiometricSeries(
        driver=driver.upper(),
        session_id=session_id,
        source=source,
        n_samples=len(samples),
        samples=samples,
        hr_baseline_bpm=None if hr_mean is None else round(hr_mean, 1),
        hr_baseline_sd=None if hr_sd is None else round(hr_sd, 2),
        coverage_note=note,
    )


def sample_at(series: BiometricSeries | None, when_utc: pd.Timestamp) -> BiometricPoint | None:
    """Nearest biometric reading to a moment, or None if nothing is close enough."""
    if series is None or not series.samples:
        return None
    best: BiometricPoint | None = None
    best_gap = None
    for s in series.samples:
        ts = pd.to_datetime(s.utc, errors="coerce")
        if ts is pd.NaT or pd.isna(ts):
            continue
        if getattr(ts, "tz", None) is not None:
            ts = ts.tz_convert("UTC").tz_localize(None)
        gap = abs((ts - when_utc).total_seconds())
        if best_gap is None or gap < best_gap:
            best, best_gap = s, gap
    if best_gap is None or best_gap > MAX_ALIGN_GAP_S:
        return None
    return best
