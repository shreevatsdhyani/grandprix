"""Per-driver calibration.

Absolute pitch and loudness are meaningless across drivers. Some are simply
loud; some have high voices. Scoring raw features would rank those drivers as
permanently stressed and quiet ones as permanently tired, which is not a
detector, it is a personality test.

So every feature is expressed as a z-score against *that driver's own* calm
radio calls. The question becomes "is he louder than he usually is?", which is
the question a race engineer actually asks.

Baselines are computed from clips the annotators labelled Calm, persisted to
disk, and rebuilt by `scripts/fit_fusion.py`.
"""

from __future__ import annotations

import json
import logging
import statistics

from app import config
from app.pipeline.prosody import FEATURE_NAMES

log = logging.getLogger(__name__)

BASELINE_PATH = config.LABELS_DIR / "driver_baselines.json"

# Fallback used when a driver has too few calm clips. Derived from the cohort,
# so a new driver still gets sensible scores on their first clip.
COHORT_KEY = "__cohort__"

# Last-resort priors, used before any clip has been labelled.
#
# Without these the cold-start path returns all-zero z-scores, which silently
# removes the prosody branch from the fusion — the one branch that can detect
# fatigue at all. A rough prior is far better than a confident zero: it gets the
# sign and rough magnitude right, and every value is replaced by real
# per-driver statistics as soon as annotations exist.
#
# [mean, stdev] per feature. Typical adult speech, measured after our -20 dBFS
# loudness normalisation so the energy terms are comparable across clips.
POPULATION_PRIOR: dict[str, list[float]] = {
    "f0_mean": [125.0, 35.0],  # Hz
    "f0_std": [28.0, 14.0],  # Hz, within-clip pitch variability
    "rms_mean": [0.095, 0.030],  # post-normalisation
    "rms_std": [0.050, 0.020],
    "speech_rate": [4.2, 1.1],  # words/sec of *speaking* time
    "pause_ratio": [0.25, 0.15],
    "jitter": [0.020, 0.012],
    "spectral_centroid": [1800.0, 500.0],  # Hz
}


def _load() -> dict[str, dict[str, list[float]]]:
    if not BASELINE_PATH.is_file():
        return {}
    try:
        return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Unreadable baselines, ignoring: %s", exc)
        return {}


def save(baselines: dict[str, dict[str, list[float]]]) -> None:
    BASELINE_PATH.write_text(json.dumps(baselines, indent=2), encoding="utf-8")


def build(samples: list[tuple[str, dict[str, float]]]) -> dict[str, dict[str, list[float]]]:
    """Compute (mean, stdev) per feature per driver from calm-labelled clips.

    `samples` is (driver, features) for Calm clips only.
    """
    by_driver: dict[str, list[dict[str, float]]] = {}
    for driver, feats in samples:
        by_driver.setdefault(driver.upper(), []).append(feats)
    by_driver[COHORT_KEY] = [f for _, f in samples]

    out: dict[str, dict[str, list[float]]] = {}
    for driver, rows in by_driver.items():
        if driver != COHORT_KEY and len(rows) < config.MIN_BASELINE_CLIPS:
            # Too few clips: a stdev from two samples is noise, and dividing by
            # it would produce wild z-scores.
            log.info("Driver %s has %d calm clips, using cohort baseline", driver, len(rows))
            continue
        stats: dict[str, list[float]] = {}
        for name in FEATURE_NAMES:
            values = [r.get(name, 0.0) for r in rows]
            mean = statistics.fmean(values)
            # A zero stdev (identical values) would divide by zero; 1.0 makes
            # the z-score reduce to a plain difference, which is safe.
            sd = statistics.pstdev(values) if len(values) > 1 else 0.0
            stats[name] = [round(mean, 6), round(sd if sd > 1e-9 else 1.0, 6)]
        out[driver] = stats
    return out


def source_for(driver: str) -> str:
    """Which reference the driver's z-scores come from.

    Surfaced to the UI so "calibrated to this driver" is never claimed when it
    is really a population prior.
    """
    baselines = _load()
    if driver.upper() in baselines:
        return "driver"
    if COHORT_KEY in baselines:
        return "cohort"
    return "prior"


def z_scores(driver: str, feats: dict[str, float]) -> dict[str, float]:
    """Express raw features as deviations from this driver's calm baseline.

    Falls back driver → cohort → population prior. It never returns all zeros:
    that would silently drop the prosody branch out of the fusion, which is the
    one branch capable of detecting fatigue.
    """
    baselines = _load()
    stats = baselines.get(driver.upper()) or baselines.get(COHORT_KEY) or POPULATION_PRIOR

    out: dict[str, float] = {}
    for name in FEATURE_NAMES:
        if name not in feats:
            # Unmeasurable feature (e.g. pitch tracking failed on a noisy
            # clip). Zero means "no deviation from normal", which is the only
            # neutral answer. Substituting 0.0 for the raw value instead would
            # produce a large negative z-score and read as strong fatigue.
            out[name] = 0.0
            continue
        mean, sd = stats.get(name, POPULATION_PRIOR.get(name, [0.0, 1.0]))
        out[name] = round((feats[name] - mean) / (sd or 1.0), 3)
    return out


def has_baseline(driver: str) -> bool:
    return driver.upper() in _load()
