"""Acoustic speech-emotion recognition.

This is the branch a one-model solution would consist of entirely, and the
reason that solution fails: the model's label space has no fatigue class. It is
kept because it is genuinely strong on agitation — an angry or panicked driver
is detected here more reliably than by prosody alone.

The raw label is preserved all the way to the UI. When the model says "sad" and
the fused verdict says "Tired", the argument for fusion is visible on screen
rather than asserted in the pitch.
"""

from __future__ import annotations

import logging

import numpy as np

from app import config
from app.pipeline import models
from app.schemas import AcousticSignal

log = logging.getLogger(__name__)

# Projection of the model's own labels onto a 0–100 stress axis. Covers the
# IEMOCAP 4-class and RAVDESS 8-class vocabularies, since we may swap between
# them after benchmarking on our labels.
STRESS_WEIGHT = {
    "ang": 95.0, "angry": 95.0, "anger": 95.0,
    "fea": 85.0, "fear": 85.0, "fearful": 85.0,
    "sad": 60.0, "sadness": 60.0,
    "dis": 70.0, "disgust": 70.0,
    "sur": 55.0, "surprised": 55.0, "surprise": 55.0,
    "hap": 25.0, "happy": 25.0, "happiness": 25.0, "joy": 25.0,
    "neu": 15.0, "neutral": 15.0, "calm": 5.0,
}
DEFAULT_WEIGHT = 40.0


def analyse(audio: np.ndarray) -> AcousticSignal:
    pipe = models.ser()
    scores = pipe({"raw": audio, "sampling_rate": config.TARGET_SR}, top_k=None)

    probs = {s["label"].lower(): float(s["score"]) for s in scores}
    total = sum(probs.values()) or 1.0
    probs = {k: round(v / total, 4) for k, v in probs.items()}

    unknown = set(probs) - set(STRESS_WEIGHT)
    if unknown:
        # A swapped model with an unmapped label would silently score 40 for
        # everything, flattening the branch. Say so rather than hide it.
        log.warning("Unmapped SER labels %s — add them to STRESS_WEIGHT", unknown)

    score = sum(STRESS_WEIGHT.get(label, DEFAULT_WEIGHT) * p for label, p in probs.items())
    top = max(probs, key=probs.get)

    return AcousticSignal(
        score=round(float(np.clip(score, 0, 100)), 1),
        probabilities=probs,
        top_label=top,
        model_id=config.SER_MODEL,
    )
