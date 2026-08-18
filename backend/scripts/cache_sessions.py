#!/usr/bin/env python3
"""Pull real F1 sessions to local disk.

Run this on day one and never think about it again. The GrandPrix round is
offline and we assume venue wifi fails, so nothing in the demo may depend on
the FastF1 API being reachable.

    python scripts/cache_sessions.py            # default five races
    python scripts/cache_sessions.py --list     # what's already cached
    python scripts/cache_sessions.py 2024 Monza R
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fastf1  # noqa: E402

from app import config  # noqa: E402

# Chosen for radio-rich, narrative races: safety cars, weather, late-stint
# degradation — the conditions under which drivers actually sound stressed.
#
# Use official event names, not circuit nicknames. FastF1 fuzzy-matches unknown
# strings and will silently resolve to the WRONG race: "Interlagos" matched
# "Dutch Grand Prix", caching Zandvoort twice with no error.
DEFAULT_SESSIONS = [
    (2024, "British Grand Prix", "R"),
    (2024, "Italian Grand Prix", "R"),
    (2024, "Singapore Grand Prix", "R"),
    (2024, "Monaco Grand Prix", "R"),
    (2023, "Dutch Grand Prix", "R"),
    (2023, "São Paulo Grand Prix", "R"),
    (2023, "Bahrain Grand Prix", "R"),
    (2023, "Monaco Grand Prix", "R"),
    (2023, "Singapore Grand Prix", "R"),
]


def cache_one(year: int, event: str, kind: str) -> bool:
    label = f"{year} {event} {kind}"
    try:
        session = fastf1.get_session(year, event, kind)

        # FastF1 fuzzy-matches unrecognised names and returns a different race
        # with only a warning buried in the log. Refuse the substitution rather
        # than cache the wrong data: a duplicate race would quietly halve our
        # sample and inflate any correlation computed across "five" sessions.
        resolved = session.event["EventName"]
        if event.lower() not in resolved.lower():
            print(f"  ✗ {label}: resolved to {resolved!r} — refusing fuzzy match")
            return False

        # Telemetry is large and we only need lap-level data; skipping it keeps
        # the cache small enough to commit to the demo laptop.
        session.load(laps=True, telemetry=False, weather=True, messages=True)
        laps = session.laps
        drivers = sorted(laps["Driver"].unique().tolist())
        print(f"  ✓ {label}: {len(laps)} laps, {len(drivers)} drivers — {', '.join(drivers[:8])}…")
        return True
    except Exception as exc:
        print(f"  ✗ {label}: {type(exc).__name__}: {exc}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("year", nargs="?", type=int)
    parser.add_argument("event", nargs="?")
    parser.add_argument("kind", nargs="?", default="R")
    parser.add_argument("--list", action="store_true", help="show cache contents and exit")
    args = parser.parse_args()

    fastf1.Cache.enable_cache(str(config.FASTF1_CACHE_DIR))
    print(f"Cache directory: {config.FASTF1_CACHE_DIR}")

    if args.list:
        entries = sorted(p.name for p in config.FASTF1_CACHE_DIR.iterdir())
        size_mb = sum(f.stat().st_size for f in config.FASTF1_CACHE_DIR.rglob("*") if f.is_file())
        print(f"{len(entries)} entries, {size_mb / 1e6:.1f} MB")
        for e in entries:
            print(f"  {e}")
        return 0

    targets = [(args.year, args.event, args.kind)] if args.year and args.event else DEFAULT_SESSIONS

    print(f"Caching {len(targets)} session(s). First run downloads; later runs are instant.\n")
    ok = sum(cache_one(*t) for t in targets)
    print(f"\n{ok}/{len(targets)} cached.")

    if ok < len(targets):
        print("Re-run to retry failures — the cache is incremental.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
