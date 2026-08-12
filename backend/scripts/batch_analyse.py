#!/usr/bin/env python3
"""Pre-analyse curated clips into the result cache.

Why this script decides whether the demo works at all:

The timeline only plots clips that already have a cached analysis
(`app/data/timeline.py`). With an empty `data/results/` the app has real lap data
and no stress data, so the hero chart has no stress line, the lead-lag panel says
"not enough radio calls", and the strategy feed is empty — three of the brief's
deliverables rendering as placeholder text. Analysing on demand during the demo
is not an answer either: ~13 s per clip, and the timeline needs tens of them.

So: run this once per session we intend to show. Afterwards every clip on the
timeline is served from disk in microseconds, and the live upload path still runs
the real pipeline — which is what actually proves the models work.

    python scripts/batch_analyse.py                          # everything
    python scripts/batch_analyse.py --session 2024-british-r
    python scripts/batch_analyse.py --session 2024-british-r --driver HAM
    python scripts/batch_analyse.py --force                  # re-analyse cached

Safe to interrupt and re-run: cached clips are skipped unless --force.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.data import store  # noqa: E402
from app.pipeline import run  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", help="Only this session id, e.g. 2024-british-r")
    ap.add_argument("--driver", help="Only this driver code, e.g. HAM")
    ap.add_argument("--limit", type=int, help="Stop after N clips")
    ap.add_argument("--force", action="store_true", help="Re-analyse clips already cached")
    args = ap.parse_args()

    records = [r for r in store.load_index() if r.exists]
    if args.session:
        records = [r for r in records if r.session_id == args.session]
    if args.driver:
        records = [r for r in records if r.driver.upper() == args.driver.upper()]

    # Lap order, so an interrupted run still leaves a contiguous stretch of the
    # race analysed rather than a scatter of holes across it.
    records.sort(key=lambda r: (r.lap is None, r.lap or 0, r.clip_id))

    if not args.force:
        records = [r for r in records if store.get_cached(r.clip_id) is None]
    if args.limit:
        records = records[: args.limit]

    if not records:
        print("Nothing to do — every matching clip is already analysed.")
        return 0

    print(f"Analysing {len(records)} clip(s). First one also pays model load.\n", flush=True)

    ok = 0
    failed: list[tuple[str, str]] = []
    started = time.perf_counter()

    for i, record in enumerate(records, start=1):
        lap = f"lap {record.lap}" if record.lap is not None else "lap ?"
        prefix = f"[{i}/{len(records)}] {record.driver:>3} {lap:>7} {record.clip_id}"
        t0 = time.perf_counter()
        try:
            analysis = run.analyse_clip(
                record.path, record.clip_id, record.driver, record.session_id, record.lap
            )
        except Exception as exc:
            # One unreadable mp3 must not cost us the other 445.
            print(f"{prefix}  FAILED  {type(exc).__name__}: {exc}", flush=True)
            failed.append((record.clip_id, f"{type(exc).__name__}: {exc}"))
            continue

        store.put_cached(analysis)
        ok += 1
        elapsed = time.perf_counter() - t0
        rate = (time.perf_counter() - started) / i
        eta = rate * (len(records) - i)
        print(
            f"{prefix}  {analysis.fusion.mood.value:<8} "
            f"stress {analysis.fusion.stress_index:>5.1f}  "
            f"{elapsed:4.1f}s  ETA {eta / 60:4.1f}m",
            flush=True,
        )

    total = time.perf_counter() - started
    print(f"\n{ok} analysed, {len(failed)} failed, {total / 60:.1f} min total.")
    if ok:
        print(f"Mean {total / max(ok, 1):.1f}s per clip.")
    if failed:
        print("\nFailures:")
        for clip_id, reason in failed[:20]:
            print(f"  {clip_id}: {reason}")
        if len(failed) > 20:
            print(f"  ... and {len(failed) - 20} more")

    print(f"\nResult cache now holds {store.cache_stats()['results_cached']} analyses.")
    return 1 if failed and not ok else 0


if __name__ == "__main__":
    raise SystemExit(main())
