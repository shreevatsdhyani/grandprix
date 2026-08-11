"""Lazy, cached model loaders.

Loading Whisper plus two classifiers costs ~15–30s on CPU. Doing that inside a
request means the first upload of the demo appears to hang, so models are
loaded once and reused, and `warm()` is called at startup to pay the cost before
anyone is watching.

`local_files_only` is honoured in offline mode: on 22 Aug we would rather fail
loudly at boot than have transformers silently try to reach the Hub over dead
venue wifi and time out mid-demo.
"""

from __future__ import annotations

import functools
import logging
import time

from app import config

log = logging.getLogger(__name__)


def _pipeline(task: str, model_id: str):
    from transformers import pipeline as hf_pipeline

    t0 = time.perf_counter()
    pipe = hf_pipeline(
        task,
        model=model_id,
        device=-1,  # CPU: the demo laptop has no GPU, so develop against reality
        model_kwargs={"local_files_only": config.OFFLINE_MODE},
    )
    log.info("Loaded %s (%s) in %.1fs", model_id, task, time.perf_counter() - t0)
    return pipe


@functools.lru_cache(maxsize=1)
def stt():
    """Whisper. Word-level timestamps are requested at call time, not here."""
    return _pipeline("automatic-speech-recognition", config.STT_MODEL)


@functools.lru_cache(maxsize=1)
def ser():
    """Acoustic emotion. Its label space is the model's own (angry/sad/neutral/
    happy) — mapping onto our vocabulary happens in fusion, not here."""
    return _pipeline("audio-classification", config.SER_MODEL)


@functools.lru_cache(maxsize=1)
def text_emotion():
    return _pipeline("text-classification", config.TEXT_EMOTION_MODEL)


def warm() -> dict[str, bool]:
    """Load everything up front. Returns which models are usable.

    Never raises: a missing model should degrade one branch of the analysis, not
    prevent the server from booting.
    """
    status: dict[str, bool] = {}
    for name, loader in (("stt", stt), ("ser", ser), ("text", text_emotion)):
        try:
            loader()
            status[name] = True
        except Exception as exc:
            log.error("Model %s unavailable: %s", name, exc)
            status[name] = False
    return status
