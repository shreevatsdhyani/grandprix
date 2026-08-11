"""Speech to text, with word timings.

Two jobs, not one:
  * the readable transcript the brief asks for, and
  * word-level timestamps, which the prosody branch needs to compute
    articulation rate. Speech rate is one of the strongest fatigue cues, and
    without timings it can only be estimated from clip duration, which counts
    silence as speech.
"""

from __future__ import annotations

import logging

import numpy as np

from app import config
from app.pipeline import models
from app.schemas import Transcript, Word

log = logging.getLogger(__name__)


def transcribe(audio: np.ndarray) -> Transcript:
    pipe = models.stt()

    try:
        result = pipe(
            {"raw": audio, "sampling_rate": config.TARGET_SR},
            return_timestamps="word",
            generate_kwargs={"language": "en", "task": "transcribe"},
        )
    except Exception as exc:
        # Word timestamps need the model's alignment heads and are not
        # available on every checkpoint. Losing them costs one prosody feature;
        # losing the transcript would cost the whole text branch.
        log.warning("Word timestamps unavailable (%s); falling back to plain decode", exc)
        result = pipe(
            {"raw": audio, "sampling_rate": config.TARGET_SR},
            generate_kwargs={"language": "en", "task": "transcribe"},
        )

    text = (result.get("text") or "").strip()
    words: list[Word] = []
    for chunk in result.get("chunks") or []:
        start, end = (chunk.get("timestamp") or (None, None))[:2]
        token = (chunk.get("text") or "").strip()
        if token and start is not None and end is not None:
            words.append(Word(text=token, start=round(float(start), 3), end=round(float(end), 3)))

    return Transcript(
        text=text or "(no speech detected)",
        words=words,
        language="en",
        stt_model=config.STT_MODEL,
    )
