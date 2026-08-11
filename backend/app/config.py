"""Runtime configuration.

Deliberately plain module-level constants rather than a settings framework —
everything here is either a path or a model id, and both need to be greppable
at 2am on demo eve.
"""

from __future__ import annotations

import os
from pathlib import Path

VERSION = "0.1.0"

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent

DATA_DIR = Path(os.getenv("GP_DATA_DIR", PROJECT_ROOT / "data"))
FASTF1_CACHE_DIR = DATA_DIR / "cache"  # FastF1's own on-disk cache
CLIPS_DIR = DATA_DIR / "clips"  # curated + uploaded radio audio
LABELS_DIR = DATA_DIR / "labels"  # human annotations, fusion training set
RESULTS_DIR = DATA_DIR / "results"  # analysed clips, so the demo never re-infers
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

for _d in (FASTF1_CACHE_DIR, CLIPS_DIR, LABELS_DIR, RESULTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------
# Hugging Face models
#
# Every id is pinned here rather than inline, so swapping a model after
# benchmarking is a one-line change and the UI provenance line stays honest.
# Sizes chosen to run on a laptop CPU in seconds: a large model that stalls on
# stage is worse than a small one that answers.
# --------------------------------------------------------------------------

STT_MODEL = os.getenv("GP_STT_MODEL", "openai/whisper-small")
SER_MODEL = os.getenv("GP_SER_MODEL", "superb/wav2vec2-base-superb-er")
TEXT_EMOTION_MODEL = os.getenv(
    "GP_TEXT_MODEL", "j-hartmann/emotion-english-distilroberta-base"
)

# Backups, swapped in if a primary is gated or underperforms on our labels.
SER_MODEL_ALT = "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition"
STT_MODEL_ALT = "distil-whisper/distil-small.en"

# --------------------------------------------------------------------------
# Audio
# --------------------------------------------------------------------------

TARGET_SR = 16_000  # what wav2vec2 and Whisper both expect
MAX_CLIP_SECONDS = 30.0  # team radio is short; guards against a bad upload
MIN_CLIP_SECONDS = 0.4

# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------

# Fallback fusion weights, used until the logistic-regression head is fitted on
# our own labelled clips (D4). Prosody is weighted highest because it is the
# only branch that can see fatigue at all.
DEFAULT_FUSION_WEIGHTS = {"prosody": 0.45, "acoustic": 0.30, "text": 0.25}

# A driver's own calm laps define their baseline. Below this many clips the
# baseline is too noisy to trust and we fall back to the cohort mean.
MIN_BASELINE_CLIPS = 3

# Below this many radio clips, the lead-lag correlation is reported but flagged
# as not significant, and the UI hedges its wording. Overclaiming loses more
# points than a modest number honestly presented.
MIN_SAMPLES_FOR_SIGNIFICANCE = 25

LEAD_LAG_RANGE = range(-4, 5)  # laps

# --------------------------------------------------------------------------
# Demo safety
#
# The GrandPrix round is offline. Assume venue wifi fails.
# --------------------------------------------------------------------------

OFFLINE_MODE = os.getenv("GP_OFFLINE", "0") == "1"
USE_FIXTURES = os.getenv("GP_USE_FIXTURES", "1") == "1"  # until the pipeline lands

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
