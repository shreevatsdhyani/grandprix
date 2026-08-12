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


def _warm_audio_stack() -> bool:
    """Pay librosa's one-off import and numba-JIT cost on synthetic audio.

    Measured, not guessed: on this laptop the FIRST `librosa.load(..., sr=16000)`
    in a process took 15.0s and every later one took 0.15s; `effects.trim` went
    4.4s → 0.02s, and `pyin` carries a similar JIT penalty. That is ~20s of
    warm-up that used to land on whichever clip was analysed first — i.e. on the
    demo — and it looks exactly like a slow model, so it would have been
    "optimised" by swapping Whisper, which was never the problem.

    A one-second tone is enough to trigger every code path we care about.
    """
    try:
        import librosa
        import numpy as np

        from app.pipeline import prosody, vad

        sr = config.TARGET_SR
        t = np.linspace(0, 1.0, sr, endpoint=False, dtype=np.float32)
        # Voiced-looking: a 140 Hz carrier with harmonics, so pyin finds a pitch
        # to track rather than bailing out early and skipping the JIT.
        tone = sum(np.sin(2 * np.pi * 140 * k * t) / k for k in (1, 2, 3)).astype(np.float32)
        tone *= 0.1

        librosa.resample(tone, orig_sr=sr, target_sr=sr, res_type="soxr_hq")
        librosa.effects.trim(tone, top_db=30.0)
        librosa.feature.rms(y=tone)
        librosa.feature.spectral_centroid(y=tone, sr=sr)
        prosody.extract(tone, [], 1.0, speech_ratio=1.0)
        vad.apply(tone)
        return True
    except Exception as exc:
        log.error("Audio stack warm-up failed: %s", exc)
        return False


def warm() -> dict[str, bool]:
    """Load everything up front. Returns which components are usable.

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
    status["audio"] = _warm_audio_stack()
    return status
