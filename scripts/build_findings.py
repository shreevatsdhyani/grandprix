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

**Pacing is the whole difficulty.** Each briefing is a large prompt, and Groq
bills prompt + max_tokens against a per-minute token quota, so an unpaced run of
175 pairs spends its first ninety seconds productively and then fails every
remaining pair on quota. `app/pipeline/findings.py` retries a rate-limited call
with a shorter prompt, which is the right move for one interactive request and
useless here: the quota needs *time*, not a smaller ask.

So this script waits. `--sleep` spaces the calls, and a quota failure is retried
after honouring the delay Groq names in its own error ("try again in 6.3s")
rather than counted as a loss. Defaults are deliberately unhurried — a run that
takes an hour unattended and stores everything beats one that takes ten minutes
and stores a twelfth of it.
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


def _is_minute_quota(message: str) -> bool:
    """A per-minute limit clears on its own, so the pair is worth retrying."""
    return "per-minute token limit" in message


def _is_daily_quota(message: str) -> bool:
    """A per-day limit does not clear, so the whole run should stop.

    This is the case worth being careful about. The free tier allows 200k tokens
    a day and a briefing costs ~7k, so the budget covers roughly 27 of them —
    and once it is gone, grinding through the remaining pairs does nothing but
    print 140 identical failures and spend the request allowance too. Better to
    stop, say how many are done, and let the caller re-run tomorrow: everything
    already written stays valid, and the run resumes exactly where it stopped.
    """
    return "daily token allowance" in message


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
    ap.add_argument(
        "--sleep",
        type=float,
        default=20.0,
        help="Seconds to wait between calls, to stay under the per-minute token quota",
    )
    ap.add_argument(
        "--retries",
        type=int,
        default=4,
        help="Times to retry a pair that failed on quota, waiting between each",
    )
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
    exhausted = ""

    for i, (session_id, driver) in enumerate(pairs, start=1):
        prefix = f"[{i}/{len(pairs)}] {session_id} {driver:>3}"
        t0 = time.perf_counter()
        result = None
        error = ""

        # Quota failures get another go after a wait; anything else — a driver
        # with no radio, a malformed session — is final on the first attempt,
        # because waiting cannot change it.
        for attempt in range(1, args.retries + 2):
            try:
                tl = timeline_module.build(session_id, driver, mode)
                result = findings_module.generate(tl, mode)
                break
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                if _is_daily_quota(str(exc)):
                    exhausted = str(exc)
                    break
                if not _is_minute_quota(str(exc)) or attempt > args.retries:
                    break
                hint = findings_module.quota_retry_hint(exc)
                # Groq's own hint beats any backoff we invent — it is the server
                # naming the moment the window reopens. Plus a small cushion,
                # because retrying exactly on the boundary tends to fail again.
                wait = hint + 2 if hint else args.sleep * attempt
                print(
                    f"{prefix}  quota — waiting {wait:.0f}s "
                    f"(attempt {attempt}/{args.retries})",
                    flush=True,
                )
                time.sleep(wait)

        if exhausted:
            print(f"\n{prefix}  STOPPING — {exhausted}", flush=True)
            break

        if result is None:
            # One driver with no radio, or one exhausted retry budget, must not
            # cost the rest of the grid.
            print(f"{prefix}  FAILED  {error}", flush=True)
            failed.append((f"{session_id} {driver}", error))
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

        # Pace the next call. Skipped on the last pair, and after a pair that
        # failed without calling Groq at all — neither spent any quota.
        if args.sleep and i < len(pairs):
            time.sleep(args.sleep)

    total = time.perf_counter() - started
    print(f"\n{ok} stored, {len(failed)} failed, {total / 60:.1f} min total.")
    if exhausted:
        remaining = len(pairs) - ok - len(failed)
        print(
            f"{remaining} pair(s) not attempted — the daily token allowance ran out.\n"
            f"Re-run this command when it resets; stored pairs are skipped, so it "
            f"picks up where it stopped."
        )
    if failed:
        print("\nFailures:")
        for pair, reason in failed[:20]:
            print(f"  {pair}: {reason}")
        if len(failed) > 20:
            print(f"  ... and {len(failed) - 20} more")

    return 1 if failed and not ok else 0


if __name__ == "__main__":
    raise SystemExit(main())
