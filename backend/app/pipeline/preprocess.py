"""Getting radio audio into a state the models can use.

Team radio is the worst-case input for speech models: heavily compressed, band
limited, clipped, and buried under engine noise. Everything here exists to make
the downstream branches comparable across clips rather than to make the audio
sound nice.

Loudness normalisation matters more than it looks. Without it, the prosody
energy feature measures the broadcast mix rather than the driver, and a clip
that happened to be recorded louder reads as a more stressed driver.
"""

from __future__ import annotations

import logging

import librosa
import numpy as np

from app import config

log = logging.getLogger(__name__)

TARGET_DBFS = -20.0  # RMS target; conventional for speech
TRIM_TOP_DB = 30.0  # anything this far below peak counts as silence


class AudioTooShort(ValueError):
    """Raised when a clip has no usable speech left after trimming."""


def load(path: str | bytes) -> tuple[np.ndarray, int]:
    """Load to mono at the model sample rate.

    librosa resamples on load, so wav/mp3/m4a/ogg all arrive in the same shape.
    """
    y, sr = librosa.load(path, sr=config.TARGET_SR, mono=True)
    return y, sr


def normalise(y: np.ndarray) -> np.ndarray:
    """Scale to a fixed RMS level, so energy features compare across clips."""
    rms = float(np.sqrt(np.mean(y**2)))
    if rms < 1e-6:  # digital silence; scaling would amplify noise to full scale
        return y
    gain = 10 ** (TARGET_DBFS / 20) / rms
    out = y * gain
    # Clip rather than let the gain push samples past full scale, which would
    # add harmonics the SER model reads as harshness.
    return np.clip(out, -1.0, 1.0)


def trim_silence(y: np.ndarray) -> np.ndarray:
    """Drop leading/trailing dead air.

    Radio clips are usually topped and tailed with squelch and engine noise.
    Leaving it in drags the pause-ratio and energy features toward "tired" for
    every clip regardless of what the driver said.
    """
    trimmed, _ = librosa.effects.trim(y, top_db=TRIM_TOP_DB)
    return trimmed if trimmed.size else y


def prepare(path: str) -> tuple[np.ndarray, float]:
    """Full preprocessing chain. Returns (audio, duration_seconds)."""
    y, sr = load(path)
    y = trim_silence(y)
    y = normalise(y)

    duration = len(y) / sr
    if duration < config.MIN_CLIP_SECONDS:
        raise AudioTooShort(
            f"Only {duration:.2f}s of audio after trimming "
            f"(minimum {config.MIN_CLIP_SECONDS}s). Is the clip mostly silence?"
        )

    if duration > config.MAX_CLIP_SECONDS:
        # Team radio is short. A long file is usually a whole race stream by
        # mistake; analysing all of it would blend many moods into one label.
        log.warning("Clip is %.1fs, truncating to %.1fs", duration, config.MAX_CLIP_SECONDS)
        y = y[: int(config.MAX_CLIP_SECONDS * sr)]
        duration = config.MAX_CLIP_SECONDS

    return y, duration
