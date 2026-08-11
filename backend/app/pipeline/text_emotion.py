"""Emotion from what was said, rather than how it sounded.

The branch that catches the clip a purely acoustic system misses: a driver who
sounds flat and controlled while saying "I've got nothing left in the rears" is
reporting fatigue in content, not tone.

It also anchors the other direction — a driver shouting cheerfully after a good
lap is loud and high-pitched, which prosody alone reads as stress.
"""

from __future__ import annotations

import logging

from app import config
from app.pipeline import models
from app.schemas import TextSignal

log = logging.getLogger(__name__)

# j-hartmann/emotion-english-distilroberta-base label space.
STRESS_WEIGHT = {
    "anger": 90.0,
    "fear": 85.0,
    "sadness": 65.0,
    "disgust": 70.0,
    "surprise": 45.0,
    "neutral": 15.0,
    "joy": 10.0,
}
DEFAULT_WEIGHT = 40.0

# Domain cues no general-purpose emotion model is trained for. Team radio is a
# tiny, idiomatic register: these phrases carry more signal than their sentiment.
FATIGUE_CUES = (
    "nothing left", "can't keep", "cant keep", "how many laps", "exhausted",
    "i'm done", "im done", "no more", "struggling", "hanging on", "dying",
)
STRESS_CUES = (
    "come on", "unbelievable", "what the", "not fair", "he pushed", "dangerous",
    "no grip", "losing", "box box", "damage", "he hit",
)
CUE_BONUS = 12.0  # points, capped — a keyword nudges, it does not decide


def analyse(text: str) -> TextSignal:
    clean = (text or "").strip()
    if not clean or clean == "(no speech detected)":
        return TextSignal(
            score=0.0,
            probabilities={},
            top_label="none",
            model_id=config.TEXT_EMOTION_MODEL,
        )

    pipe = models.text_emotion()
    scores = pipe(clean, top_k=None)

    probs = {s["label"].lower(): round(float(s["score"]), 4) for s in scores}
    score = sum(STRESS_WEIGHT.get(label, DEFAULT_WEIGHT) * p for label, p in probs.items())

    lowered = clean.lower()
    if any(cue in lowered for cue in FATIGUE_CUES):
        score += CUE_BONUS
    if any(cue in lowered for cue in STRESS_CUES):
        score += CUE_BONUS

    return TextSignal(
        score=round(min(100.0, max(0.0, score)), 1),
        probabilities=probs,
        top_label=max(probs, key=probs.get) if probs else "none",
        model_id=config.TEXT_EMOTION_MODEL,
    )
