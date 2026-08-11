#!/usr/bin/env python3
"""Download real team radio for a cached session, and index it.

The F1 live-timing service publishes a per-session team-radio manifest, with a
UTC timestamp and car number for every transmission. That is everything needed
to build the dataset automatically:

    UTC timestamp + car number  ->  driver code + lap number  ->  index.csv row

which replaces days of manually clipping broadcast footage.

    python scripts/fetch_radio.py                      # all cached sessions
    python scripts/fetch_radio.py 2024-british-r       # one session
    python scripts/fetch_radio.py --drivers HAM,VER    # only these drivers
    python scripts/fetch_radio.py --dry-run            # list, download nothing

Clips land in data/clips/ and rows are appended to data/clips/index.csv with
the `label` column left blank — that column is the human annotation the fusion
head trains on, and only a person can fill it in.

This is public broadcast audio, used here for analysis and demonstration.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.disable(logging.WARNING)
warnings.filterwarnings("ignore")

import pandas as pd  # noqa: E402

import fastf1  # noqa: E402

from app import config  # noqa: E402
from app.data import store  # noqa: E402
from app.data.fastf1_client import AVAILABLE, make_session_id  # noqa: E402

fastf1.Cache.enable_cache(str(config.FASTF1_CACHE_DIR))


def load_with_dates(session_id: str):
    """Load a session including telemetry.

    Telemetry is needed only because `LapStartDate` is derived from `t0_date`,
    which FastF1 populates during telemetry load — without it every lap date is
    NaT and radio cannot be matched to a lap.

    The runtime app deliberately does NOT do this: telemetry costs ~19s and
    ~120 MB per session. Here it is a one-off, because the lap numbers it
    produces are written into index.csv and never recomputed.
    """
    for year, event, kind in AVAILABLE:
        if make_session_id(year, event, kind) == session_id:
            session = fastf1.get_session(year, event, kind)
            session.load(laps=True, telemetry=True, weather=False, messages=False)
            return session
    raise KeyError(f"Unknown session {session_id!r}")

LIVETIMING = "https://livetiming.formula1.com/static"
TIMEOUT = 30


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
        # The manifest is served with a UTF-8 BOM.
        return json.loads(response.read().decode("utf-8-sig"))


def download(url: str, dest: Path) -> int:
    with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
        data = response.read()
    dest.write_bytes(data)
    return len(data)


def lap_for(laps: pd.DataFrame, when: pd.Timestamp) -> int | None:
    """Which lap was the driver on when this radio was transmitted?

    Matched on LapStartDate: the transmission belongs to the last lap that had
    already started. Radio sent before the driver's first timed lap returns
    None rather than being forced onto lap 1.
    """
    if "LapStartDate" not in laps or laps["LapStartDate"].isna().all():
        return None
    started = laps[laps["LapStartDate"] <= when]
    if started.empty:
        return None
    return int(started.iloc[-1]["LapNumber"])


def process(session_id: str, drivers: set[str] | None, dry_run: bool) -> list[dict]:
    session = load_with_dates(session_id)
    path = session.session_info.get("Path")
    if not path:
        print(f"  {session_id}: no live-timing path in session info")
        return []

    # Percent-encode the path: event names carry accents ("São_Paulo") and
    # urllib raises UnicodeEncodeError on a raw non-ASCII URL. The failure is
    # caught below and reported as "manifest unavailable", which silently cost
    # a whole race's clips until someone noticed the count was short.
    base = f"{LIVETIMING}/{urllib.parse.quote(path.rstrip('/'), safe='/')}"
    try:
        manifest = fetch_json(f"{base}/TeamRadio.json")
    except Exception as exc:
        print(f"  {session_id}: manifest unavailable — {exc}")
        return []

    captures = manifest.get("Captures", [])

    # Car number -> three-letter code. The manifest identifies drivers by
    # number; everything else in the project uses the abbreviation.
    results = session.results
    number_to_code = {
        str(row.DriverNumber): str(row.Abbreviation) for row in results.itertuples()
    }

    laps_by_driver = {
        code: session.laps.pick_drivers(code).sort_values("LapNumber")
        for code in set(number_to_code.values())
    }

    rows: list[dict] = []
    for capture in captures:
        code = number_to_code.get(str(capture.get("RacingNumber")))
        if code is None or (drivers and code not in drivers):
            continue

        when = pd.to_datetime(capture["Utc"], utc=True).tz_localize(None)
        lap = lap_for(laps_by_driver.get(code, pd.DataFrame()), when)

        remote = capture["Path"]
        clip_id = f"{session_id}-{code}-{Path(remote).stem.split('_')[-1]}"
        filename = f"{clip_id}.mp3"
        dest = config.CLIPS_DIR / filename

        if dest.is_file():
            continue  # already downloaded; re-runs are incremental

        if dry_run:
            print(f"    would fetch {code:>3} lap {str(lap):>3}  {remote}")
        else:
            try:
                size = download(f"{base}/{remote}", dest)
                print(f"    {code:>3}  lap {str(lap):>3}  {size / 1024:6.0f} KB  {filename}")
            except Exception as exc:
                print(f"    {code:>3}  FAILED {remote}: {exc}")
                continue

        rows.append(
            {
                "clip_id": clip_id,
                "session_id": session_id,
                "driver": code,
                "lap": lap if lap is not None else "",
                "filename": filename,
                "label": "",  # ← the human annotation; only a person fills this
                "annotator": "",
                "notes": capture["Utc"],
            }
        )
    return rows


def append_index(rows: list[dict]) -> None:
    """Append to index.csv, creating it with a header if needed."""
    fields = ["clip_id", "session_id", "driver", "lap", "filename", "label", "annotator", "notes"]
    existing = {r.clip_id for r in store.load_index()}
    fresh = [r for r in rows if r["clip_id"] not in existing]
    if not fresh:
        return

    is_new = not store.CLIP_INDEX.is_file() or store.CLIP_INDEX.stat().st_size == 0
    with store.CLIP_INDEX.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        if is_new:
            writer.writeheader()
        writer.writerows(fresh)
    print(f"\nAppended {len(fresh)} row(s) to {store.CLIP_INDEX}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", nargs="?", help="session id, e.g. 2024-british-r")
    parser.add_argument("--drivers", help="comma-separated codes, e.g. HAM,VER")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    drivers = {d.strip().upper() for d in args.drivers.split(",")} if args.drivers else None
    targets = (
        [args.session]
        if args.session
        else [make_session_id(y, e, k) for y, e, k in AVAILABLE]
    )

    all_rows: list[dict] = []
    for session_id in targets:
        print(f"\n{session_id}")
        try:
            all_rows += process(session_id, drivers, args.dry_run)
        except Exception as exc:
            print(f"  failed: {type(exc).__name__}: {exc}")

    if not args.dry_run:
        append_index(all_rows)

    print(f"\n{len(all_rows)} new clip(s).")
    if all_rows and not args.dry_run:
        print(
            "\nNext: open data/clips/index.csv and fill the `label` column with\n"
            "Calm / Stressed / Tired for each clip, then run scripts/fit_fusion.py"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
