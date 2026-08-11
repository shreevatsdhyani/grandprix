"""Vocal-effort features — the branch that makes fatigue detectable at all.

No off-the-shelf speech-emotion model has a "tired" class; they are trained on
IEMOCAP/RAVDESS, whose labels are emotions. Fatigue is not an emotion, it is a
change in how the voice is *produced*, and it shows up here:

    stressed  →  pitch up, pitch variable, loud, fast, few pauses
    tired     →  pitch down, pitch FLAT, quiet, slow, long pauses

Those two states are near-opposites on most of these axes, which is exactly why
a single scalar "arousal" score cannot separate them and a feature vector can.

Everything is returned raw here. Z-scoring against the driver's own baseline
happens in `baseline.py`, because a naturally loud driver is not a stressed one.
"""

from __future__ import annotations

import logging

import librosa
import numpy as np

from app import config
from app.schemas import Word

log = logging.getLogger(__name__)

# Human speech F0 range, wide enough for any driver, narrow enough to reject
# engine harmonics that would otherwise be tracked as pitch.
F0_MIN, F0_MAX = 60.0, 400.0

FEATURE_NAMES = (
    "f0_mean",
    "f0_std",
    "rms_mean",
    "rms_std",
    "speech_rate",
    "pause_ratio",
    "jitter",
    "spectral_centroid",
)


def extract(
    audio: np.ndarray,
    words: list[Word],
    duration: float,
    speech_ratio: float | None = None,
) -> dict[str, float]:
    """Raw prosodic features for one clip.

    `audio` is expected to be speech-only (post-VAD). `speech_ratio` is the
    fraction of the ORIGINAL clip that was speech — pause ratio has to be
    measured before the pauses are removed, or it is zero by construction.

    Features that could not be measured are OMITTED rather than set to zero. A
    zero pitch is not "a very low voice", it is "no measurement", and encoding
    it as a value produces a large negative z-score that reads as strong
    evidence of fatigue. Callers must treat a missing key as unknown.
    """
    sr = config.TARGET_SR
    feats: dict[str, float] = {}

    # --- pitch ------------------------------------------------------------
    # pyin is slower than piptrack but far more robust on noisy, band-limited
    # radio audio, where piptrack locks onto engine tones.
    try:
        f0, voiced_flag, _ = librosa.pyin(
            audio, fmin=F0_MIN, fmax=F0_MAX, sr=sr, frame_length=1024
        )
        voiced = f0[~np.isnan(f0)]
    except Exception as exc:
        log.warning("Pitch tracking failed: %s", exc)
        voiced = np.array([])

    if voiced.size >= 2:
        feats["f0_mean"] = float(np.mean(voiced))
        feats["f0_std"] = float(np.std(voiced))
        # Jitter: mean absolute period-to-period variation, normalised. Rises
        # with vocal strain and fatigue.
        periods = 1.0 / voiced
        feats["jitter"] = float(np.mean(np.abs(np.diff(periods))) / np.mean(periods))
    else:
        # Pitch tracking failed — heavy noise, or genuinely unvoiced audio.
        # Leave the keys absent so they score as unknown, not as "pitch of 0 Hz".
        log.debug("No voiced frames; omitting pitch features")

    # --- energy -----------------------------------------------------------
    rms = librosa.feature.rms(y=audio)[0]
    feats["rms_mean"] = float(np.mean(rms))
    feats["rms_std"] = float(np.std(rms))

    # --- timing -----------------------------------------------------------
    if words:
        # Articulation rate over spoken time only. Dividing by clip duration
        # instead would let a long silence masquerade as slow speech.
        speaking = sum(max(0.0, w.end - w.start) for w in words)
        if speaking > 0.2:
            feats["speech_rate"] = len(words) / speaking

    # Pause ratio comes from VAD on the ORIGINAL clip. Measuring it on
    # speech-only audio would return ~0 for every clip, which is not a
    # measurement — and since long pauses are a primary fatigue cue, a constant
    # would quietly bias every driver toward the same verdict.
    if speech_ratio is not None:
        feats["pause_ratio"] = float(np.clip(1.0 - speech_ratio, 0.0, 1.0))

    # --- timbre -----------------------------------------------------------
    # Brightness rises with vocal effort; a useful cross-check on energy that
    # is less sensitive to the broadcast mix.
    feats["spectral_centroid"] = float(np.mean(librosa.feature.spectral_centroid(y=audio, sr=sr)))

    return {k: round(v, 6) for k, v in feats.items()}
