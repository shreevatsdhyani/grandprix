#!/usr/bin/env python3
"""Fit the fusion head and per-driver baselines from labelled clips.

This is the script that turns the project from "plumbing works" into "the
classifier works". Run it whenever new annotations land.

    python scripts/fit_fusion.py              # fit and report
    python scripts/fit_fusion.py --dry-run    # report only, write nothing

What it does, in order:

  1. Extract features for every clip in data/clips/index.csv (cached, so
     re-running after adding ten clips only processes those ten).
  2. Build per-driver baselines from Calm-labelled clips, falling back to all
     of that driver's clips, then to the cohort.
  3. Fit a multinomial logistic regression on the labelled set.
  4. Report accuracy against the naive single-model baseline, with
     leave-one-out cross-validation because the dataset is small.

Step 4 is the number that goes on the slide. It is also the number that
justifies the whole fusion argument, so it must be measured honestly:
cross-validated, never training accuracy.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.disable(logging.WARNING)
warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402

from app import config  # noqa: E402
from app.data import store  # noqa: E402
from app.pipeline import baseline, fusion, preprocess, prosody, ser, stt, text_emotion, vad  # noqa: E402
from app.schemas import Mood, ProsodySignal  # noqa: E402

FEATURE_CACHE = config.LABELS_DIR / "features.json"
VALID_LABELS = {m.value.lower(): m for m in Mood}


def extract_all(records: list[store.ClipRecord], refresh: bool = False) -> dict[str, dict]:
    """Feature extraction for every clip, cached to disk by clip id."""
    cache: dict[str, dict] = {}
    if FEATURE_CACHE.is_file() and not refresh:
        cache = json.loads(FEATURE_CACHE.read_text(encoding="utf-8"))

    todo = [r for r in records if r.clip_id not in cache and r.exists]
    if todo:
        print(f"Extracting features for {len(todo)} new clip(s)…")

    for i, record in enumerate(todo, start=1):
        try:
            audio, duration = preprocess.prepare(str(record.path))
            # Must mirror run.py exactly: prosody runs on VAD-trimmed speech-only
            # audio and receives the speech_ratio from the original clip.
            # The old code passed the full clip without VAD, so features like
            # pause_ratio and rms_mean were measured over engine noise during
            # training but over speech at inference — a distribution mismatch
            # that made the fitted coefficients systematically wrong.
            speech, speech_ratio = vad.apply(audio)
            transcript = stt.transcribe(audio)
            cache[record.clip_id] = {
                "driver": record.driver.upper(),
                "raw": prosody.extract(
                    speech, transcript.words, len(speech) / config.TARGET_SR,
                    speech_ratio=speech_ratio,
                ),
                "acoustic": ser.analyse(audio).model_dump(mode="json"),
                "text": text_emotion.analyse(transcript.text).model_dump(mode="json"),
                "transcript": transcript.text,
            }
            print(f"  [{i}/{len(todo)}] {record.clip_id}")
        except Exception as exc:
            print(f"  [{i}/{len(todo)}] {record.clip_id}: FAILED — {exc}")

    FEATURE_CACHE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    return cache


def build_baselines(records, cache, dry_run: bool) -> None:
    """Per-driver reference statistics.

    Preference order: the driver's Calm clips, then all of that driver's clips,
    then the cohort. Using all clips is a reasonable proxy — most team radio is
    unremarkable, so a driver's overall mean is close to their calm mean.
    """
    calm_samples, all_samples = [], []
    for r in records:
        entry = cache.get(r.clip_id)
        if not entry:
            continue
        all_samples.append((entry["driver"], entry["raw"]))
        if (r.label or "").lower() == "calm":
            calm_samples.append((entry["driver"], entry["raw"]))

    source = "Calm-labelled" if len(calm_samples) >= config.MIN_BASELINE_CLIPS else "all"
    samples = calm_samples if source == "Calm-labelled" else all_samples

    if not samples:
        print("\nBaselines: no clips available — population priors remain in use.")
        return

    stats = baseline.build(samples)
    print(f"\nBaselines from {len(samples)} {source} clip(s): {len(stats)} reference set(s)")
    for driver in sorted(stats):
        if driver != baseline.COHORT_KEY:
            print(f"  {driver}: f0 {stats[driver]['f0_mean'][0]:.1f} Hz, "
                  f"rate {stats[driver]['speech_rate'][0]:.2f} w/s")
    if not dry_run:
        baseline.save(stats)


def _vector(entry: dict) -> list[float]:
    from app.schemas import AcousticSignal, TextSignal

    z = baseline.z_scores(entry["driver"], entry["raw"])
    p = ProsodySignal(
        score=0.0,
        f0_mean_z=z["f0_mean"],
        f0_std_z=z["f0_std"],
        rms_mean_z=z["rms_mean"],
        speech_rate_z=z["speech_rate"],
        pause_ratio_z=z["pause_ratio"],
        jitter_z=z["jitter"],
    )
    return fusion.feature_vector(
        p, AcousticSignal(**entry["acoustic"]), TextSignal(**entry["text"])
    )


def fit(records, cache, dry_run: bool) -> None:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import LeaveOneOut, cross_val_predict

    labelled = [
        (r, cache[r.clip_id])
        for r in records
        if r.clip_id in cache and (r.label or "").lower() in VALID_LABELS
    ]

    if len(labelled) < 15:
        print(
            f"\nFusion head: {len(labelled)} labelled clip(s) — need at least 15 to fit.\n"
            "The rule-based fallback stays in use until then, and the UI reports it."
        )
        return

    X = np.array([_vector(entry) for _, entry in labelled])
    y = np.array([VALID_LABELS[(r.label or "").lower()].value for r, _ in labelled])

    counts = {label: int((y == label).sum()) for label in sorted(set(y))}
    print(f"\nFusion head: {len(labelled)} labelled clips {counts}")

    if len(set(y)) < 2:
        print("  Only one class present — cannot fit.")
        return
    if len(set(y)) < 3:
        print(
            "  WARNING: only two classes present in the labelled set "
            f"({sorted(set(y))}). The fitted head will be a binary classifier. "
            "The inference path handles this correctly (binary sigmoid, not "
            "1-class softmax), but the missing class will always score 0 — "
            "add more labels covering the third class before shipping the demo."
        )

    model = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced")

    # Leave-one-out: with ~100 clips a single train/test split would be too
    # noisy to trust, and training accuracy would be meaningless.
    smallest = min(counts.values())
    if smallest >= 2:
        predicted = cross_val_predict(model, X, y, cv=LeaveOneOut())
        accuracy = float((predicted == y).mean())
    else:
        predicted, accuracy = None, float("nan")
        print("  A class has <2 examples; skipping cross-validation.")

    # The comparison that matters: what a single-model solution would have got
    # on exactly the same clips.
    naive_correct = 0
    for r, entry in labelled:
        from app.schemas import AcousticSignal

        naive_mood = fusion.naive(AcousticSignal(**entry["acoustic"])).mood.value
        naive_correct += naive_mood == (r.label or "").title()
    naive_accuracy = naive_correct / len(labelled)

    print(f"  fusion  (leave-one-out) : {accuracy:.1%}")
    print(f"  naive   (single model)  : {naive_accuracy:.1%}")
    if accuracy == accuracy:  # not NaN
        print(f"  improvement             : {accuracy - naive_accuracy:+.1%}")

    if predicted is not None:
        print("\n  confusion (rows = true, cols = predicted)")
        classes = sorted(set(y))
        header = "           " + "".join(f"{c[:5]:>8}" for c in classes)
        print(header)
        for truth in classes:
            row = "".join(
                f"{int(((y == truth) & (predicted == p)).sum()):>8}" for p in classes
            )
            print(f"  {truth[:9]:<9}{row}")

    model.fit(X, y)
    payload = {
        "classes": [str(c) for c in model.classes_],
        "coef": model.coef_.tolist(),
        "intercept": model.intercept_.tolist(),
        "features": list(fusion.FEATURES),
        "n_train": len(labelled),
        "cv_accuracy": None if accuracy != accuracy else round(accuracy, 4),
        "naive_accuracy": round(naive_accuracy, 4),
    }
    if not dry_run:
        fusion.MODEL_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nWrote {fusion.MODEL_PATH}")
    else:
        print("\n--dry-run: nothing written")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--refresh", action="store_true", help="re-extract all features")
    args = parser.parse_args()

    records = store.load_index()
    if not records:
        print(
            f"No clips indexed. Add audio to {config.CLIPS_DIR} and rows to "
            f"{store.CLIP_INDEX}\n\n"
            "  clip_id,session_id,driver,lap,filename,label,annotator,notes\n"
            "  ham-l44,2024-british-r,HAM,44,ham-l44.wav,Tired,alice,end of stint"
        )
        return 1

    print(f"{len(records)} clip(s) indexed, {sum(1 for r in records if r.label)} labelled")
    cache = extract_all(records, refresh=args.refresh)
    build_baselines(records, cache, args.dry_run)
    fit(records, cache, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
