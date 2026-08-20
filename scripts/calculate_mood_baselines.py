#!/usr/bin/env python3
"""
Calculate mood-specific baseline features for each driver.

For each driver and mood combination (Calm, Tired, Stressed), calculate:
- Number of clips in that mood
- Mean pitch (z-score)
- Mean energy (z-score)
- Mean speech rate (z-score)

This allows the UI to show mood-specific baseline ranges on hover.
"""

import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any
import statistics


def load_all_clips(results_dir: Path) -> List[Dict[str, Any]]:
    """Load all clip analysis results from the results directory."""
    clips = []
    for json_file in results_dir.glob("*.json"):
        # Skip upload files
        if json_file.stem.startswith("upload-"):
            continue

        try:
            with open(json_file, "r") as f:
                clip = json.load(f)
                clips.append(clip)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: Skipping {json_file.name}: {e}")

    return clips


def calculate_mood_baselines(clips: List[Dict[str, Any]]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    Calculate mood-specific baselines for each driver.

    Returns:
        {
            "HAM": {
                "Calm": {
                    "n_clips": 45,
                    "f0_mean": 0.12,
                    "rms_mean": -0.34,
                    "speech_rate": 0.05
                },
                "Tired": {...},
                "Stressed": {...}
            },
            ...
        }
    """
    # Group clips by driver and mood
    driver_mood_clips = defaultdict(lambda: defaultdict(list))

    for clip in clips:
        driver = clip.get("driver")
        mood = clip.get("fusion", {}).get("mood")

        if not driver or not mood:
            continue

        # Extract prosody features
        prosody = clip.get("signals", {}).get("prosody", {})
        f0_mean_z = prosody.get("f0_mean_z")
        rms_mean_z = prosody.get("rms_mean_z")
        speech_rate_z = prosody.get("speech_rate_z")

        # Only include clips with all required features
        if all(v is not None for v in [f0_mean_z, rms_mean_z, speech_rate_z]):
            driver_mood_clips[driver][mood].append({
                "f0_mean_z": f0_mean_z,
                "rms_mean_z": rms_mean_z,
                "speech_rate_z": speech_rate_z
            })

    # Calculate statistics for each driver-mood combination
    baselines = {}

    for driver, mood_clips in driver_mood_clips.items():
        baselines[driver] = {}

        for mood in ["Calm", "Tired", "Stressed"]:
            clips_for_mood = mood_clips.get(mood, [])

            if len(clips_for_mood) > 0:
                baselines[driver][mood] = {
                    "n_clips": len(clips_for_mood),
                    "f0_mean": statistics.mean(c["f0_mean_z"] for c in clips_for_mood),
                    "rms_mean": statistics.mean(c["rms_mean_z"] for c in clips_for_mood),
                    "speech_rate": statistics.mean(c["speech_rate_z"] for c in clips_for_mood),
                    # Also calculate std dev for ranges
                    "f0_std": statistics.stdev(c["f0_mean_z"] for c in clips_for_mood) if len(clips_for_mood) > 1 else 0,
                    "rms_std": statistics.stdev(c["rms_mean_z"] for c in clips_for_mood) if len(clips_for_mood) > 1 else 0,
                    "speech_rate_std": statistics.stdev(c["speech_rate_z"] for c in clips_for_mood) if len(clips_for_mood) > 1 else 0,
                }
            else:
                baselines[driver][mood] = None

    return baselines


def main():
    # Path to results directory
    results_dir = Path(__file__).parent.parent / "data" / "results"

    if not results_dir.exists():
        print(f"Error: Results directory not found: {results_dir}")
        return

    print(f"Loading clips from {results_dir}...")
    clips = load_all_clips(results_dir)
    print(f"Loaded {len(clips)} clips")

    print("Calculating mood-specific baselines...")
    baselines = calculate_mood_baselines(clips)

    # Print summary
    print(f"\nFound baselines for {len(baselines)} drivers:")
    for driver, moods in sorted(baselines.items()):
        print(f"\n{driver}:")
        for mood in ["Calm", "Tired", "Stressed"]:
            if moods.get(mood):
                stats = moods[mood]
                print(f"  {mood}: {stats['n_clips']} clips, "
                      f"pitch={stats['f0_mean']:.3f}, "
                      f"energy={stats['rms_mean']:.3f}, "
                      f"rate={stats['speech_rate']:.3f}")
            else:
                print(f"  {mood}: No clips")

    # Save to file
    output_file = results_dir.parent / "mood_baselines.json"
    with open(output_file, "w") as f:
        json.dump(baselines, f, indent=2)

    print(f"\nSaved mood baselines to {output_file}")


if __name__ == "__main__":
    main()
