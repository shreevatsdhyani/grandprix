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
# Precomputed race context (track/tyre/position/situation) per session. Built
# offline by scripts/build_context.py because resolving it needs FastF1 loaded
# with telemetry, which costs ~19s and ~80MB per session — far too much for the
# request path. Runtime only ever reads these JSON files.
CONTEXT_DIR = DATA_DIR / "context"
# Uploaded driver biometrics, one file per (session, driver). Absent file means
# no data; nothing here is ever synthesised.
BIOMETRICS_DIR = DATA_DIR / "biometrics"
# LLM-authored top findings, one file per (session, driver, mode). Persistent
# rather than in-memory because findings are deterministic in their inputs and
# expensive in their generation: the same driver's briefing should be written
# once and then read for free, across restarts and across deploys of the same
# data. `?refresh=true` is the only thing that overwrites a file here.
FINDINGS_DIR = DATA_DIR / "findings"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

for _d in (
    FASTF1_CACHE_DIR,
    CLIPS_DIR,
    LABELS_DIR,
    RESULTS_DIR,
    CONTEXT_DIR,
    BIOMETRICS_DIR,
    FINDINGS_DIR,
):
    _d.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------
# Hugging Face models
#
# Every id is pinned here rather than inline, so swapping a model after
# benchmarking is a one-line change and the UI provenance line stays honest.
# Sizes chosen to run on a laptop CPU in seconds: a large model that stalls on
# stage is worse than a small one that answers.
# --------------------------------------------------------------------------

STT_MODEL = os.getenv("GP_STT_MODEL", "distil-whisper/distil-small.en")
SER_MODEL = os.getenv("GP_SER_MODEL", "superb/wav2vec2-base-superb-er")
TEXT_EMOTION_MODEL = os.getenv(
    "GP_TEXT_MODEL", "j-hartmann/emotion-english-distilroberta-base"
)

# Silero VAD, as ONNX. Lives here rather than inside pipeline/vad.py so that
# warm_models.py and /api/health can both see it: it is a fourth model the demo
# depends on, and when it is missing offline the pipeline degrades silently to
# untrimmed audio rather than failing loudly.
VAD_MODEL = os.getenv("GP_VAD_MODEL", "istupakov/silero-vad-onnx")
VAD_FILE = "silero_vad_16k_op15.onnx"

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

# Fixtures default to OFF now that the pipeline has landed.
#
# This default used to be "1", which was correct while the frontend was being
# built against a frozen contract and wrong the moment real inference worked:
# with fixtures on, POST /api/analyse returns a canned result WITHOUT READING
# THE UPLOADED FILE, /api/sessions advertises one race that isn't cached, and
# /api/laps 501s. A judge uploading their own clip would have been shown a
# pre-baked answer. Nothing may silently substitute demo data for real output.
#
# Set GP_USE_FIXTURES=1 deliberately for frontend work with no models present.
USE_FIXTURES = os.getenv("GP_USE_FIXTURES", "0") == "1"

# --------------------------------------------------------------------------
# Race context resolution
# --------------------------------------------------------------------------

# How far either side of a radio call to collect race-control messages. Two
# minutes is roughly a lap at most circuits, so an engineer sees the flags the
# driver had actually just driven through.
RACE_CONTROL_WINDOW_S = 120

# A stint needs this many timed laps before a degradation slope means anything.
# Below it we report None rather than fitting a line through two points.
MIN_LAPS_FOR_DEG_SLOPE = 4

# Gap to the car ahead below which a driver counts as "in traffic" — inside
# DRS range plus a margin, i.e. close enough that the car ahead is dictating
# their lap rather than their own pace.
IN_TRAFFIC_GAP_S = 1.5

# Telemetry classification thresholds for the intra-lap zone label.
BRAKING_ZONE_MIN_BRAKE = 0.5  # FastF1 Brake is 0/1
HIGH_SPEED_MIN_KPH = 250
CORNER_PROXIMITY_M = 60  # within this of a mapped corner apex

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # `vite preview` — how the built bundle gets demoed if the dev server is not
    # what we run on stage.
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
