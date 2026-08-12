#!/usr/bin/env python3
"""Auto-label clips using the HF model outputs already on disk.

After batch_analyse.py runs, every clip has a result JSON in data/results/.
That JSON contains fusion.mood (Calm / Stressed / Tired) produced by the four
Hugging Face models working together:

    Silero VAD  →  Whisper STT  →  wav2vec2 SER  →  distilroberta text-emotion
                                         ↘               ↙
                               prosody features (8, z-scored)
                                         ↓
                               rule-based fusion  →  mood label

This script reads those labels and writes them back into data/clips/index.csv
so fit_fusion.py can train the logistic regression head on them.

No human listening. No external API. The HF models do the labelling.

    python scripts/auto_label.py                  # label everything with a result
    python scripts/auto_label.py --dry-run        # show what would be written
    python scripts/auto_label.py --min-conf 0.6   # only label high-confidence clips
    python scripts/auto_label.py --overwrite       # re-label clips that already have a label
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402

INDEX_CSV = config.CLIPS_DIR / "index.csv"
RESULTS_DIR = config.DATA_DIR / "results"


def load_index() -> tuple[list[dict], list[str]]:
    with INDEX_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    return rows, fieldnames


def save_index(rows: list[dict], fieldnames: list[str]) -> None:
    with INDEX_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def load_result(clip_id: str) -> dict | None:
    p = RESULTS_DIR / f"{clip_id}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-label clips from HF model outputs")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would change without writing anything")
    parser.add_argument("--min-conf", type=float, default=0.0,
                        help="Only label clips where fusion confidence >= this value (0.0–1.0)")
    parser.add_argument("--overwrite", action="store_true",
                        help="Re-label clips that already have a manual label")
    args = parser.parse_args()

    if not INDEX_CSV.exists():
        print("index.csv not found — run fetch_radio.py first.")
        sys.exit(1)

    if not RESULTS_DIR.exists() or not any(RESULTS_DIR.glob("*.json")):
        print("No results found in data/results/ — run batch_analyse.py first.")
        sys.exit(1)

    rows, fieldnames = load_index()

    labelled = skipped_existing = skipped_no_result = skipped_low_conf = 0

    for row in rows:
        clip_id = row["clip_id"]

        # Skip if already labelled and not overwriting
        if row.get("label", "").strip() and not args.overwrite:
            skipped_existing += 1
            continue

        result = load_result(clip_id)
        if result is None:
            skipped_no_result += 1
            continue

        # Read the mood and confidence from the fusion output
        # data/results/{clip_id}.json has the full ClipAnalysis schema
        try:
            mood = result["fusion"]["mood"]           # "Calm" | "Stressed" | "Tired"
            confidence = result["fusion"]["confidence"]  # 0.0–1.0
        except (KeyError, TypeError):
            skipped_no_result += 1
            continue

        if confidence < args.min_conf:
            skipped_low_conf += 1
            continue

        if mood not in {"Calm", "Stressed", "Tired"}:
            skipped_no_result += 1
            continue

        if args.dry_run:
            existing = row.get("label", "")
            change = f"{existing!r} → {mood!r}" if existing else f"(blank) → {mood!r}"
            print(f"  {clip_id:45s}  conf={confidence:.2f}  {change}")
        else:
            row["label"] = mood

        labelled += 1

    print()
    print(f"Results:")
    print(f"  {'Would label' if args.dry_run else 'Labelled'} : {labelled}")
    print(f"  Skipped (already labelled, --overwrite not set): {skipped_existing}")
    print(f"  Skipped (no result file yet)                   : {skipped_no_result}")
    if args.min_conf > 0:
        print(f"  Skipped (confidence < {args.min_conf:.2f})               : {skipped_low_conf}")

    if not args.dry_run and labelled > 0:
        save_index(rows, fieldnames)
        print(f"\n  Saved → {INDEX_CSV}")
        print(f"  Next step: python scripts/fit_fusion.py")
    elif args.dry_run:
        print("\n  (dry run — nothing written)")
    else:
        print("\n  Nothing to label.")


if __name__ == "__main__":
    main()
