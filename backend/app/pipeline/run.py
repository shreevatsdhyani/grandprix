"""The analysis pipeline, end to end.

    clip ─► preprocess ─► STT ─┬─► text emotion ──┐
                               ├─► acoustic SER ──┤
                               └─► prosody ───────┤
                                     z-score vs driver baseline
                                                  ▼
                                          fusion + naive
                                                  ▼
                                            ClipAnalysis

Stage callbacks are optional so the WebSocket route can stream progress without
this module knowing anything about transport.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from pathlib import Path

from app import config
from app.pipeline import baseline, fusion, models, preprocess, prosody, ser, stt, text_emotion, vad
from app.schemas import (
    ClipAnalysis,
    PipelineStage,
    ProsodySignal,
    SignalBreakdown,
)

log = logging.getLogger(__name__)

OnStage = Callable[[PipelineStage, str], None] | None


def _noop(stage: PipelineStage, message: str) -> None:
    pass


def analyse_clip(
    audio_path: str | Path,
    clip_id: str,
    driver: str,
    session_id: str,
    lap: int | None = None,
    on_stage: OnStage = None,
) -> ClipAnalysis:
    """Run one clip through every branch and return the finished analysis."""
    emit = on_stage or _noop
    started = time.perf_counter()
    driver = driver.upper()

    emit(PipelineStage.PREPROCESS, "Resampling to 16 kHz mono, normalising loudness")
    audio, duration = preprocess.prepare(str(audio_path))

    emit(PipelineStage.VAD, "Isolating speech from engine noise")
    # Prosody runs on speech-only audio: silence measured as speech would
    # corrupt pause ratio and articulation rate, the two features fatigue is
    # actually read from. STT and SER keep the full clip — Whisper uses the
    # surrounding context, and the emotion model was trained on whole
    # utterances.
    speech, speech_ratio = vad.apply(audio)

    emit(PipelineStage.STT, "Transcribing speech")
    transcript = stt.transcribe(audio)

    emit(PipelineStage.PROSODY, "Extracting pitch, energy and articulation rate")
    raw_feats = prosody.extract(
        speech,
        transcript.words,
        len(speech) / config.TARGET_SR,
        speech_ratio=speech_ratio,
    )
    z = baseline.z_scores(driver, raw_feats)

    emit(PipelineStage.ACOUSTIC, "Running acoustic emotion model")
    acoustic = ser.analyse(audio)

    emit(PipelineStage.TEXT, "Reading emotion from the transcript")
    text = text_emotion.analyse(transcript.text)

    emit(PipelineStage.FUSION, "Fusing signals against driver baseline")
    prosody_signal = ProsodySignal(
        # The prosody branch's own contribution to the stress axis: distance
        # from this driver's normal, in either direction, on the axes that
        # matter. Fatigue and agitation both register.
        score=_prosody_score(z),
        f0_mean_z=z["f0_mean"],
        f0_std_z=z["f0_std"],
        rms_mean_z=z["rms_mean"],
        speech_rate_z=z["speech_rate"],
        pause_ratio_z=z["pause_ratio"],
        jitter_z=z["jitter"],
    )
    signals = SignalBreakdown(prosody=prosody_signal, acoustic=acoustic, text=text)

    fused, fitted = fusion.fuse(prosody_signal, acoustic, text)
    fused.fitted = fitted
    naive_result = fusion.naive(acoustic)
    if not fitted:
        log.info("Fusion head not fitted; using rule-based fallback for %s", clip_id)

    emit(PipelineStage.ALIGN, "Aligning to lap data")

    return ClipAnalysis(
        clip_id=clip_id,
        driver=driver,
        session_id=session_id,
        lap=lap,
        duration_s=round(duration, 2),
        audio_url=f"/api/clips/{clip_id}",
        transcript=transcript,
        signals=signals,
        fusion=fused,
        naive=naive_result,
        processing_ms=int((time.perf_counter() - started) * 1000),
        cached=False,
    )


def _prosody_score(z: dict[str, float]) -> float:
    """Map z-scored features onto 0–100.

    Both directions count: a driver well below their own baseline on energy and
    rate is as informative as one well above it. A plain sum would let the two
    cancel out and report a fading driver as perfectly normal.
    """
    deviation = (
        abs(z.get("f0_mean", 0.0))
        + abs(z.get("f0_std", 0.0))
        + abs(z.get("rms_mean", 0.0))
        + abs(z.get("speech_rate", 0.0))
        + abs(z.get("pause_ratio", 0.0))
    ) / 5.0
    return round(min(100.0, deviation * 40.0), 1)


def warm() -> dict[str, bool]:
    return models.warm()
