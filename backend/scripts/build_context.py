#!/usr/bin/env python3
"""Precompute race context for every cached session.

Run this once after `cache_sessions.py` and `fetch_radio.py`. It is the only part
of this project that reaches the network at build time, and — like
`fetch_radio.py` — it caches what it fetches so reruns are offline.

    python scripts/build_context.py              # all sessions
    python scripts/build_context.py --list        # what's already built
    python scripts/build_context.py --offline     # fail rather than fetch
    python scripts/build_context.py 2024-british-r

What it does
------------
1. Fetches OpenF1 `/team_radio` per session and builds
   `{livetiming filename timestamp -> (utc, driver_number)}`.

   This is the join that makes everything else possible. Our clip ids are
   `{session}-{DRIVER}-{HHMMSS}`, and that trailing number is lifted verbatim
   from F1's own recording filename (`FERALO01_14_20231105_174526.mp3`). OpenF1
   publishes both the filename and the true UTC timestamp of the broadcast, so
   matching on the filename gives us an exact instant per clip.

   Do NOT be tempted to parse the timestamp as a clock time. It is not
   consistently UTC and not consistently local: Silverstone's filenames run an
   hour ahead of UTC, Interlagos' match it, Singapore's are eight hours ahead.
   The string is an opaque key. Treat it as one.

2. Resolves every clip against the FastF1 cache loaded with telemetry, producing
   a ClipContext with track, tyre, position and situation.

3. Writes `data/context/{session_id}.json` and backfills recovered lap numbers
   into `data/clips/index.csv` — 67 of the 446 clips have a blank lap there, and
   `timeline.build()` silently drops every one of them.

Unmatched clips are named in the output, never silently dropped. Same reasoning as
`cache_sessions.py` refusing a fuzzy event match: a quiet halving of the sample
would inflate every correlation computed downstream.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import warnings  # noqa: E402

warnings.filterwarnings("ignore")

import pandas as pd  # noqa: E402

from app import config  # noqa: E402
from app.context import frames as frames_mod, resolver, track as track_mod, tyre as tyre_mod  # noqa: E402
from app.data import fastf1_client  # noqa: E402
from app.schemas import SessionContext  # noqa: E402

OPENF1 = "https://api.openf1.org/v1"

# OpenF1 session keys, pinned so a rerun cannot silently resolve to a different
# session if their lookup semantics change. Each verified against
# /sessions?year=&country_name=&session_name=Race, and each paired with the race
# date so `_verify_key` can refuse a mismatch.
#
# Note "Italy" returns TWO races — Imola (9515) and Monza (9590). Our cached
# Italian GP is Monza. Looking up by country alone would have picked the wrong
# one, which is the same class of mistake `cache_sessions.py` guards against when
# it refuses FastF1's fuzzy event matching.
SESSION_KEYS = {
    "2024-british-r": (9558, "2024-07-07"),
    "2024-italian-r": (9590, "2024-09-01"),
    "2024-singapore-r": (9606, "2024-09-22"),
    "2024-monaco-r": (9523, "2024-05-26"),
    "2023-dutch-r": (9149, "2023-08-27"),
    "2023-sao-paulo-r": (9205, "2023-11-05"),
    "2023-bahrain-r": (7953, "2023-03-05"),
    "2023-monaco-r": (9094, "2023-05-28"),
    "2023-singapore-r": (9165, "2023-09-17"),
}
# Must stay in step with `fastf1_client.AVAILABLE`. A session listed there but
# missing here cannot be resolved, and the mismatch is easy to miss when someone
# adds a race — so it is checked at startup rather than discovered as an empty
# context file three steps later.


def _radio_cache_path(session_id: str) -> Path:
    return config.CONTEXT_DIR / f"openf1_radio_{session_id}.json"


def fetch_team_radio(session_id: str, *, offline: bool) -> list[dict]:
    """OpenF1 team-radio records for a session, cached to disk on first fetch."""
    cache = _radio_cache_path(session_id)
    if cache.exists():
        return json.loads(cache.read_text())
    if offline:
        raise RuntimeError(
            f"No cached OpenF1 radio index for {session_id} and --offline was given. "
            f"Run once with network access to populate {cache}."
        )
    pinned = SESSION_KEYS.get(session_id)
    if pinned is None:
        raise RuntimeError(f"No OpenF1 session key pinned for {session_id!r}")
    key, expected_date = pinned
    _verify_key(session_id, key, expected_date)

    url = f"{OPENF1}/team_radio?session_key={key}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    if not data:
        raise RuntimeError(f"OpenF1 returned no team radio for session_key={key}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data, indent=1))
    return data


def _verify_key(session_id: str, key: int, expected_date: str) -> None:
    """Refuse to build if the pinned key is not the race we think it is.

    A wrong session key does not error — it returns a perfectly well-formed set of
    radio records from a different Grand Prix, whose filename timestamps would
    simply fail to match ours. The result would look like "0 clips resolved"
    rather than "wrong race", so check the date up front and say so plainly.
    """
    url = f"{OPENF1}/sessions?session_key={key}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        rows = json.loads(resp.read().decode())
    if not rows:
        raise RuntimeError(f"OpenF1 knows no session_key={key} (pinned for {session_id})")
    got = rows[0]
    if not str(got.get("date_start", "")).startswith(expected_date):
        raise RuntimeError(
            f"session_key={key} is {got.get('location')} on "
            f"{str(got.get('date_start'))[:10]}, expected {expected_date} for {session_id}. "
            "Refusing to build against the wrong race."
        )
    if str(got.get("session_name")) != "Race":
        raise RuntimeError(
            f"session_key={key} is a {got.get('session_name')}, not the Race, for {session_id}"
        )


def timestamp_index(records: list[dict]) -> dict[str, dict]:
    """`{filename timestamp -> record}` — the join key against our clip ids."""
    out: dict[str, dict] = {}
    for r in records:
        url = r.get("recording_url") or ""
        stem = url.rsplit("/", 1)[-1]
        if not stem.endswith(".mp3"):
            continue
        ts = stem[:-4].rsplit("_", 1)[-1]
        if ts.isdigit():
            out[ts] = r
    return out


def clips_for_session(session_id: str) -> list[dict]:
    index = config.CLIPS_DIR / "index.csv"
    if not index.exists():
        return []
    with index.open() as fh:
        return [r for r in csv.DictReader(fh) if r.get("session_id") == session_id]


def build_one(session_id: str, *, offline: bool) -> tuple[bool, str]:
    clips = clips_for_session(session_id)
    if not clips:
        return False, "no clips in index.csv"

    radio = timestamp_index(fetch_team_radio(session_id, offline=offline))

    session = fastf1_client.load_session_full(session_id)
    frames = frames_mod.from_session(session, session_id)

    # Session-wide context first: the per-lap track evolution needs every lap
    # start, which is also what the crossover detection reads.
    lap_starts: dict[int, pd.Timedelta] = {}
    for row in frames.all_laps.itertuples(index=False):
        if pd.isna(row.LapNumber) or pd.isna(row.LapStartTime):
            continue
        lap = int(row.LapNumber)
        # Earliest start across the field, i.e. when the leader began the lap.
        if lap not in lap_starts or row.LapStartTime < lap_starts[lap]:
            lap_starts[lap] = row.LapStartTime

    evolution = track_mod.evolution(frames.weather, frames.all_laps, lap_starts)

    stints = {}
    for drv, g in frames.all_laps.groupby("Driver"):
        stints[str(drv)] = tyre_mod.summarise_stints(g.sort_values("LapNumber"))

    lap_len = None
    if not frames.corners.empty and "Distance" in frames.corners:
        # Corner distances stop short of the finish line; the lap is longer than
        # the last corner, so this is a floor, not the length. Left None rather
        # than reported wrong — position.py measures it per lap from telemetry.
        lap_len = None

    contexts = {}
    unmatched: list[str] = []
    recovered: dict[str, int] = {}

    for row in clips:
        clip_id = row["clip_id"]
        driver = row["driver"]
        ts = clip_id.rsplit("-", 1)[-1]
        rec = radio.get(ts)
        if rec is None:
            unmatched.append(clip_id)
            continue
        when = pd.Timestamp(rec["date"])
        if when.tz is not None:
            when = when.tz_convert("UTC").tz_localize(None)
        ctx = resolver.resolve_at(frames, driver, when, clip_id=clip_id)
        contexts[clip_id] = ctx
        if ctx.lap is not None and not (row.get("lap") or "").strip():
            recovered[clip_id] = ctx.lap

    ctx_obj = SessionContext(
        session_id=session_id,
        built_at=datetime.now(timezone.utc).isoformat(),
        source="fastf1-cache+openf1-team-radio",
        lap_count=int(frames.all_laps["LapNumber"].max()) if not frames.all_laps.empty else None,
        circuit_corners=None if frames.corners.empty else int(len(frames.corners)),
        lap_length_m=lap_len,
        track_evolution=evolution,
        wet_dry_crossovers=track_mod.wet_dry_crossovers(evolution),
        stints_by_driver=stints,
        clip_contexts=contexts,
        unmatched_clips=sorted(unmatched),
    )

    out = config.CONTEXT_DIR / f"{session_id}.json"
    out.write_text(ctx_obj.model_dump_json(indent=1))

    if recovered:
        backfill_laps(recovered)

    with_pos = sum(1 for c in contexts.values() if c.position and c.position.nearest_corner is not None)
    msg = (
        f"{len(contexts)}/{len(clips)} clips resolved, {with_pos} with corner data, "
        f"{len(recovered)} lap numbers recovered, "
        f"{len(ctx_obj.wet_dry_crossovers)} wet/dry crossovers"
    )
    if unmatched:
        msg += f"\n      unmatched ({len(unmatched)}): {', '.join(unmatched[:6])}"
        if len(unmatched) > 6:
            msg += f" … +{len(unmatched) - 6} more"
    return True, msg


def backfill_laps(recovered: dict[str, int]) -> None:
    """Write recovered lap numbers into index.csv.

    Only fills blanks — an existing value is left alone. If the index already
    says a lap, that came from `fetch_radio.py`'s own mapping and disagreeing
    with it silently would hide a real inconsistency.
    """
    index = config.CLIPS_DIR / "index.csv"
    with index.open() as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames or []
        rows = list(reader)
    changed = 0
    for r in rows:
        lap = recovered.get(r["clip_id"])
        if lap is not None and not (r.get("lap") or "").strip():
            r["lap"] = str(lap)
            changed += 1
    if not changed:
        return
    tmp = index.with_suffix(".csv.tmp")
    with tmp.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    tmp.replace(index)


def check_session_coverage() -> list[str]:
    """Sessions the app serves but we have no OpenF1 key for."""
    return [
        fastf1_client.make_session_id(y, e, k)
        for y, e, k in fastf1_client.AVAILABLE
        if fastf1_client.make_session_id(y, e, k) not in SESSION_KEYS
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session_id", nargs="?", help="build just this session")
    ap.add_argument("--list", action="store_true", help="show what's built and exit")
    ap.add_argument("--offline", action="store_true", help="fail rather than fetch from OpenF1")
    args = ap.parse_args()

    if args.list:
        built = sorted(config.CONTEXT_DIR.glob("*.json"))
        print(f"{config.CONTEXT_DIR}")
        if not built:
            print("  (nothing built yet)")
        for p in built:
            print(f"  {p.name}  {p.stat().st_size / 1e6:.2f} MB")
        return 0

    missing = check_session_coverage()
    if missing:
        print(
            "WARNING: these sessions are in fastf1_client.AVAILABLE but have no "
            f"OpenF1 session key pinned, so their clips cannot be resolved: {', '.join(missing)}\n"
        )

    targets = [args.session_id] if args.session_id else list(SESSION_KEYS)
    print(f"Building context for {len(targets)} session(s).\n")
    ok = 0
    for sid in targets:
        print(f"  {sid} …", flush=True)
        try:
            good, msg = build_one(sid, offline=args.offline)
        except Exception as exc:
            print(f"    ✗ {type(exc).__name__}: {exc}")
            continue
        print(f"    {'✓' if good else '✗'} {msg}")
        ok += bool(good)

    print(f"\n{ok}/{len(targets)} built.")
    return 0 if ok == len(targets) else 1


if __name__ == "__main__":
    raise SystemExit(main())
