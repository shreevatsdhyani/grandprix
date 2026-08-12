"""Voice activity detection — finding the speech inside the noise.

Team radio is mostly *not* speech. A transmission opens with squelch, carries
engine noise throughout, and trails off into static. Feeding all of that to the
downstream branches corrupts every one of them:

  * Whisper hallucinates words out of engine tone,
  * the emotion model scores the noise floor rather than the driver,
  * and worst, the prosody branch measures silence as if it were speech —
    pause ratio and articulation rate are exactly the features fatigue is read
    from, so noise makes every driver look tired.

The energy-threshold trim in `preprocess` only removes leading and trailing
silence. This removes the gaps *inside* the clip too, and reports how much of
the transmission was actually speech.

Model: `istupakov/silero-vad-onnx` from the Hub — Silero VAD v5 as ONNX.
Chosen over the plan's first pick (`pyannote/segmentation-3.0`) because pyannote
is gated: it needs an account, an accepted licence and a token. Silero is
ungated, ~2 MB, and runs in milliseconds on CPU. The plan listed exactly this
fallback for exactly this reason.
"""

from __future__ import annotations

import functools
import logging

import numpy as np

from app import config

log = logging.getLogger(__name__)

VAD_MODEL = config.VAD_MODEL
VAD_FILE = config.VAD_FILE

# Silero v5 advances 512 samples (32 ms) at a time, but each forward pass must
# be fed 576: the 64 samples immediately preceding the hop are carried in as
# context. Feeding a bare 512 runs without error and returns near-zero
# probability on obvious speech — a silent wrong answer, so the two constants
# are kept separate and named.
HOP = 512
CONTEXT = 64
WINDOW = HOP + CONTEXT  # 576

SPEECH_THRESHOLD = 0.5

# Keep a little audio either side of detected speech: cutting exactly on the
# boundary clips plosives and word onsets, which Whisper needs.
PAD_MS = 96

# Bridge short gaps rather than shattering a sentence into fragments. Natural
# between-word pauses are ~100-300 ms and are themselves a fatigue signal, so
# they must survive into the prosody features.
MAX_GAP_MS = 320

MIN_SPEECH_MS = 120  # discard blips: radio clicks, single noise spikes


@functools.lru_cache(maxsize=1)
def _session():
    import onnxruntime
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(
        VAD_MODEL, VAD_FILE, local_files_only=config.OFFLINE_MODE
    )
    options = onnxruntime.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    return onnxruntime.InferenceSession(path, options, providers=["CPUExecutionProvider"])


def speech_probabilities(audio: np.ndarray) -> np.ndarray:
    """Per-hop probability that the audio contains speech.

    Element i covers samples [i*HOP, (i+1)*HOP), so segment boundaries derived
    from this array line up with the original audio.
    """
    session = _session()
    state = np.zeros((2, 1, 128), dtype=np.float32)
    sr = np.array(config.TARGET_SR, dtype=np.int64)
    context = np.zeros(CONTEXT, dtype=np.float32)

    probs = []
    for start in range(0, len(audio) - HOP + 1, HOP):
        hop = audio[start : start + HOP].astype(np.float32)
        chunk = np.concatenate([context, hop]).reshape(1, -1)
        out, state = session.run(None, {"input": chunk, "state": state, "sr": sr})
        probs.append(float(out[0][0]))
        context = hop[-CONTEXT:]
    return np.array(probs)


def _merge(segments: list[tuple[int, int]], max_gap: int) -> list[tuple[int, int]]:
    if not segments:
        return []
    merged = [segments[0]]
    for start, end in segments[1:]:
        if start - merged[-1][1] <= max_gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def detect(audio: np.ndarray) -> tuple[list[tuple[int, int]], float]:
    """Locate speech.

    Returns (segments in samples, speech_ratio) where speech_ratio is the
    fraction of the clip that is speech — a useful quality gate on its own: a
    clip that is 8% speech is mostly engine noise and its emotion scores should
    not be trusted.
    """
    if len(audio) < WINDOW:
        return [(0, len(audio))], 1.0

    probs = speech_probabilities(audio)
    if probs.size == 0:
        return [(0, len(audio))], 1.0

    voiced = probs >= SPEECH_THRESHOLD
    raw: list[tuple[int, int]] = []
    start: int | None = None
    for i, is_speech in enumerate(voiced):
        if is_speech and start is None:
            start = i
        elif not is_speech and start is not None:
            raw.append((start * HOP, i * HOP))
            start = None
    if start is not None:
        raw.append((start * HOP, len(audio)))

    sr = config.TARGET_SR
    merged = _merge(raw, max_gap=int(MAX_GAP_MS / 1000 * sr))

    pad = int(PAD_MS / 1000 * sr)
    min_len = int(MIN_SPEECH_MS / 1000 * sr)
    segments = [
        (max(0, s - pad), min(len(audio), e + pad))
        for s, e in merged
        if e - s >= min_len
    ]

    speech_samples = sum(e - s for s, e in segments)
    return segments, round(speech_samples / len(audio), 3)


def apply(audio: np.ndarray) -> tuple[np.ndarray, float]:
    """Return speech-only audio and the speech ratio of the original.

    Falls back to the untouched clip whenever VAD finds nothing or the model is
    unavailable — losing the whole analysis because one branch failed would be
    a worse outcome than analysing a noisy clip.
    """
    try:
        segments, ratio = detect(audio)
    except Exception as exc:
        log.warning("VAD unavailable (%s); using untrimmed audio", exc)
        return audio, 1.0

    if not segments:
        log.info("VAD found no speech; using untrimmed audio")
        return audio, 0.0

    trimmed = np.concatenate([audio[s:e] for s, e in segments])
    if len(trimmed) < config.MIN_CLIP_SECONDS * config.TARGET_SR:
        # Over-aggressive on a quiet clip — keep the original rather than hand
        # downstream a fragment.
        return audio, ratio
    return trimmed, ratio
