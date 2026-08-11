#!/usr/bin/env python3
"""Download every HF model to the local cache.

Run once, on a good connection. After this the app works with wifi off, which
is the requirement for the offline GrandPrix round on 22 Aug.
"""
from __future__ import annotations
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config

TARGETS = [
    ("STT", config.STT_MODEL, "automatic-speech-recognition"),
    ("Acoustic emotion", config.SER_MODEL, "audio-classification"),
    ("Text emotion", config.TEXT_EMOTION_MODEL, "text-classification"),
]

def main() -> int:
    from transformers import pipeline
    failed = []
    for label, model_id, task in TARGETS:
        print(f"→ {label}: {model_id}", flush=True)
        t0 = time.perf_counter()
        try:
            pipeline(task, model=model_id, device=-1)
            print(f"  ✓ ready in {time.perf_counter() - t0:.1f}s", flush=True)
        except Exception as exc:
            print(f"  ✗ {type(exc).__name__}: {exc}", flush=True)
            failed.append(model_id)
    if failed:
        print(f"\nFAILED: {failed}")
        print("If a model is gated, accept its terms on huggingface.co while logged in.")
        return 1
    print("\nAll models cached. The app can now run offline.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
