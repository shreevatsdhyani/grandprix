"""Combining the three branches into one verdict.

Two scoring paths are always computed, because the comparison between them is
the project's central claim:

  naive   argmax of the acoustic emotion model, mapped onto our vocabulary.
          This is what a one-model submission produces. It structurally cannot
          return Tired, because no fatigue class exists in its label space.

  fusion  prosody z-scores + acoustic + text, through a small logistic
          regression fitted on our own annotations.

Until enough labelled clips exist to fit the head, fusion falls back to an
interpretable rule using the same features. The fallback is deliberately not
hidden: `fitted=False` propagates so the UI and the pitch stay honest about
which one is running.
"""

from __future__ import annotations

import json
import logging

import numpy as np

from app import config
from app.schemas import (
    AcousticSignal,
    Mood,
    MoodResult,
    ProsodySignal,
    ScoringMode,
    TextSignal,
)

log = logging.getLogger(__name__)

MODEL_PATH = config.LABELS_DIR / "fusion_head.json"

# Order matters: the fitted coefficients are stored positionally.
FEATURES = (
    "f0_mean_z",
    "f0_std_z",
    "rms_mean_z",
    "speech_rate_z",
    "pause_ratio_z",
    "jitter_z",
    "acoustic_score",
    "text_score",
)

# How the acoustic model's own labels collapse onto our three classes. Note
# there is no route to TIRED: that is the point, and it is what the naive path
# demonstrates on stage.
NAIVE_MAP = {
    "ang": Mood.STRESSED, "angry": Mood.STRESSED, "anger": Mood.STRESSED,
    "fea": Mood.STRESSED, "fear": Mood.STRESSED, "fearful": Mood.STRESSED,
    "dis": Mood.STRESSED, "disgust": Mood.STRESSED,
    "sur": Mood.STRESSED, "surprise": Mood.STRESSED, "surprised": Mood.STRESSED,
    "sad": Mood.CALM, "sadness": Mood.CALM,
    "hap": Mood.CALM, "happy": Mood.CALM, "joy": Mood.CALM,
    "neu": Mood.CALM, "neutral": Mood.CALM, "calm": Mood.CALM,
}


def feature_vector(
    prosody: ProsodySignal, acoustic: AcousticSignal, text: TextSignal
) -> list[float]:
    return [
        prosody.f0_mean_z,
        prosody.f0_std_z,
        prosody.rms_mean_z,
        prosody.speech_rate_z,
        prosody.pause_ratio_z,
        prosody.jitter_z or 0.0,
        acoustic.score / 100.0,
        text.score / 100.0,
    ]


# --------------------------------------------------------------------------
# Naive path
# --------------------------------------------------------------------------


def naive(acoustic: AcousticSignal) -> MoodResult:
    """What a single-model solution returns."""
    mood = NAIVE_MAP.get(acoustic.top_label, Mood.CALM)
    confidence = acoustic.probabilities.get(acoustic.top_label, 0.5)

    # Spread the model's own probability mass over our classes. Tired keeps a
    # small residual only because the model is uncertain, never because it
    # detected fatigue.
    stressed = sum(
        p for lab, p in acoustic.probabilities.items() if NAIVE_MAP.get(lab) is Mood.STRESSED
    )
    calm = sum(
        p for lab, p in acoustic.probabilities.items() if NAIVE_MAP.get(lab) is Mood.CALM
    )
    total = stressed + calm or 1.0
    probs = {
        Mood.CALM: round(calm / total * 0.94, 3),
        Mood.STRESSED: round(stressed / total * 0.94, 3),
        Mood.TIRED: 0.06,
    }

    return MoodResult(
        mood=mood,
        confidence=round(float(confidence), 3),
        stress_index=acoustic.score,
        probabilities=probs,
        mode=ScoringMode.NAIVE,
    )


# --------------------------------------------------------------------------
# Fusion path
# --------------------------------------------------------------------------


def _load_head() -> dict | None:
    if not MODEL_PATH.is_file():
        return None
    try:
        return json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Unreadable fusion head, using fallback: %s", exc)
        return None


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


def _rule_based(
    prosody: ProsodySignal, acoustic: AcousticSignal, text: TextSignal
) -> tuple[dict[Mood, float], float]:
    """Interpretable fallback until the head is fitted on real annotations.

    Encodes the same asymmetry the features were chosen for: stress raises
    pitch, energy and rate; fatigue lowers all three and lengthens pauses.
    """
    w = config.DEFAULT_FUSION_WEIGHTS

    # Arousal: how activated the voice is, either direction.
    arousal = (
        w["prosody"] * prosody.score
        + w["acoustic"] * acoustic.score
        + w["text"] * text.score
    )

    # Fatigue evidence: everything pointing down and slow at once.
    fatigue = (
        max(0.0, -prosody.f0_std_z)
        + max(0.0, -prosody.rms_mean_z)
        + max(0.0, -prosody.speech_rate_z)
        + max(0.0, prosody.pause_ratio_z)
        + max(0.0, (prosody.jitter_z or 0.0))
    ) / 5.0

    # Agitation evidence: pitch and energy above this driver's own normal.
    agitation = (
        max(0.0, prosody.f0_mean_z)
        + max(0.0, prosody.f0_std_z)
        + max(0.0, prosody.rms_mean_z)
        + max(0.0, prosody.speech_rate_z)
    ) / 4.0

    logits = np.array(
        [
            2.0 - arousal / 30.0,  # calm
            agitation * 1.6 + acoustic.score / 60.0,  # stressed
            fatigue * 2.2 + text.score / 90.0,  # tired
        ]
    )
    probs = _softmax(logits)
    mapping = {
        Mood.CALM: round(float(probs[0]), 3),
        Mood.STRESSED: round(float(probs[1]), 3),
        Mood.TIRED: round(float(probs[2]), 3),
    }
    stress_index = float(np.clip(arousal * 0.7 + fatigue * 30.0, 0, 100))
    return mapping, stress_index


def fuse(
    prosody: ProsodySignal, acoustic: AcousticSignal, text: TextSignal
) -> tuple[MoodResult, bool]:
    """Returns (result, fitted) where `fitted` is False for the fallback."""
    head = _load_head()

    if head:
        x = np.array(feature_vector(prosody, acoustic, text))
        coef = np.array(head["coef"])  # (3, n_features)
        intercept = np.array(head["intercept"])
        probs_arr = _softmax(coef @ x + intercept)
        classes = [Mood(c) for c in head["classes"]]
        probs = {m: round(float(p), 3) for m, p in zip(classes, probs_arr)}
        for m in Mood:
            probs.setdefault(m, 0.0)
        stress_index = float(
            np.clip(100 * (probs[Mood.STRESSED] + probs[Mood.TIRED] * 0.9), 0, 100)
        )
        fitted = True
    else:
        probs, stress_index = _rule_based(prosody, acoustic, text)
        fitted = False

    mood = max(probs, key=probs.get)
    return (
        MoodResult(
            mood=mood,
            confidence=round(probs[mood], 3),
            stress_index=round(stress_index, 1),
            probabilities=probs,
            mode=ScoringMode.FUSION,
        ),
        fitted,
    )
