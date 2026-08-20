#!/usr/bin/env python3
"""Pre-generate top findings for every driver in every cached session.

Same bargain as `batch_analyse.py`, one layer up. Findings are one large LLM call
per (session, driver, mode) — seconds of latency — and they are fully determined
by race data that will never change again. Generating them while someone waits is
the only version of this that feels broken, so generate them here instead and let
the panel read from `data/findings/` in microseconds.

    python scripts/build_findings.py                          # everything
    python scripts/build_findings.py --session 2024-italian-r
    python scripts/build_findings.py --session 2024-italian-r --driver GAS
    python scripts/build_findings.py --mode naive             # default: fusion
    python scripts/build_findings.py --force                  # rewrite cached

Safe to interrupt and re-run: an already-stored pair is skipped unless --force,
so a rate limit part-way through costs only the pairs it did not reach. Needs
GROQ_API_KEY, the same key `/api/findings` needs; without it every pair fails
with the same message and nothing is written.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.data import fastf1_client, findings_store, timeline as timeline_module  # noqa: E402
from app.pipeline import findings as findings_module  # noqa: E402
from app.schemas import ScoringMode  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", help="Only this session id, e.g. 2024-italian-r")
    ap.add_argument("--driver", help="Only this driver code, e.g. GAS")
    ap.add_argument(
        "--mode",
        default=ScoringMode.FUSION.value,
        choices=[m.value for m in ScoringMode],
        help="Scoring mode to generate for (the panel caches each mode separately)",
    )
    ap.add_argument("--limit", type=int, help="Stop after N pairs")
    ap.add_argument("--force", action="store_true", help="Rewrite pairs already stored")
    args = ap.parse_args()

    mode = ScoringMode(args.mode)

    sessions = fastf1_client.list_sessions()
    if args.session:
        sessions = [s for s in sessions if s.session_id == args.session]
    if not sessions:
        print("No matching cached sessions. Run: python scripts/cache_sessions.py")
        return 1

    pairs: list[tuple[str, str]] = []
    for session in sessions:
        for driver in session.drivers:
            if args.driver and driver.upper() != args.driver.upper():
                continue
            if not args.force and findings_store.load(session.session_id, driver, mode.value):
                continue
            pairs.append((session.session_id, driver))

    if args.limit:
        pairs = pairs[: args.limit]

    if not pairs:
        print(f"Nothing to do — every matching pair already has {mode.value} findings.")
        return 0

    print(f"Generating {len(pairs)} briefing(s) in {mode.value} mode.\n", flush=True)

    ok = 0
    failed: list[tuple[str, str]] = []
    started = time.perf_counter()

    for i, (session_id, driver) in enumerate(pairs, start=1):
        prefix = f"[{i}/{len(pairs)}] {session_id} {driver:>3}"
        t0 = time.perf_counter()
        try:
            tl = timeline_module.build(session_id, driver, mode)
            result = findings_module.generate(tl, mode)
        except Exception as exc:
            # One driver with no radio, or one rate-limited call, must not cost
            # the rest of the grid.
            print(f"{prefix}  FAILED  {type(exc).__name__}: {exc}", flush=True)
            failed.append((f"{session_id} {driver}", f"{type(exc).__name__}: {exc}"))
            continue

        findings_store.save(session_id, driver, mode.value, result.model_dump(mode="json"))
        ok += 1
        elapsed = time.perf_counter() - t0
        eta = ((time.perf_counter() - started) / i) * (len(pairs) - i)
        dropped = f"  {result.dropped_findings} dropped" if result.dropped_findings else ""
        print(
            f"{prefix}  {len(result.findings)} finding(s){dropped}  "
            f"{elapsed:5.1f}s  ETA {eta / 60:4.1f}m",
            flush=True,
        )

    total = time.perf_counter() - started
    print(f"\n{ok} stored, {len(failed)} failed, {total / 60:.1f} min total.")
    if failed:
        print("\nFailures:")
        for pair, reason in failed[:20]:
            print(f"  {pair}: {reason}")
        if len(failed) > 20:
            print(f"  ... and {len(failed) - 20} more")

    return 1 if failed and not ok else 0


if __name__ == "__main__":
    raise SystemExit(main())
