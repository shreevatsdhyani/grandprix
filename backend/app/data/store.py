"""Clip registry and analysis cache.

Two jobs:

1. Know which radio clips exist, which driver and lap each belongs to.
2. Remember analysis results so a clip is never re-inferred.

Plain JSON on disk, no database. The dataset is ~100 clips; a DB would be pure
schedule risk. The result cache is also the demo's safety net — on 22 Aug every
clip on the timeline is served from here in microseconds, so a slow or failed
model load cannot break the presentation. Live upload still runs the real
pipeline, which is what proves it works.
"""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path

from pydantic import BaseModel

from app import config
from app.schemas import ClipAnalysis

log = logging.getLogger(__name__)

CLIP_INDEX = config.CLIPS_DIR / "index.csv"
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".flac"}


class ClipRecord(BaseModel):
    """One curated radio clip and its metadata.

    `label` is the human annotation used to fit the fusion head, and is
    deliberately optional: clips are collected before they are labelled.
    """

    clip_id: str
    session_id: str
    driver: str
    lap: int | None = None
    filename: str
    label: str | None = None
    annotator: str | None = None
    notes: str | None = None

    @property
    def path(self) -> Path:
        return config.CLIPS_DIR / self.filename

    @property
    def exists(self) -> bool:
        return self.path.is_file()


def load_index() -> list[ClipRecord]:
    """Read data/clips/index.csv.

    Missing file is normal before clip collection starts, so it returns empty
    rather than raising — the app must boot with no data at all.
    """
    if not CLIP_INDEX.is_file():
        return []

    records: list[ClipRecord] = []
    with CLIP_INDEX.open(newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh), start=2):
            row = {k: (v.strip() or None) for k, v in row.items() if k}
            try:
                records.append(
                    ClipRecord(
                        clip_id=row.get("clip_id") or Path(row["filename"]).stem,
                        session_id=row["session_id"],
                        driver=row["driver"],
                        lap=int(row["lap"]) if row.get("lap") else None,
                        filename=row["filename"],
                        label=row.get("label"),
                        annotator=row.get("annotator"),
                        notes=row.get("notes"),
                    )
                )
            except (KeyError, ValueError) as exc:
                # One malformed row must not hide the other ninety-nine.
                log.warning("clips/index.csv line %d skipped: %s", i, exc)
    return records


def clips_for(session_id: str, driver: str) -> list[ClipRecord]:
    return [
        c
        for c in load_index()
        if c.session_id == session_id and c.driver.upper() == driver.upper()
    ]


def find_clip(clip_id: str) -> ClipRecord | None:
    return next((c for c in load_index() if c.clip_id == clip_id), None)


# --------------------------------------------------------------------------
# Analysis result cache
# --------------------------------------------------------------------------


def _result_path(clip_id: str) -> Path:
    # Guard against a clip_id from an upload escaping the results directory.
    safe = "".join(ch for ch in clip_id if ch.isalnum() or ch in "-_")
    return config.RESULTS_DIR / f"{safe}.json"


def get_cached(clip_id: str) -> ClipAnalysis | None:
    path = _result_path(clip_id)
    if not path.is_file():
        return None
    try:
        analysis = ClipAnalysis.model_validate_json(path.read_text(encoding="utf-8"))
        analysis.cached = True
        return analysis
    except Exception as exc:
        # A stale cache entry written against an older schema should be
        # recomputed, not crash the request.
        log.warning("Discarding unreadable cache for %s: %s", clip_id, exc)
        path.unlink(missing_ok=True)
        return None


def put_cached(analysis: ClipAnalysis) -> None:
    _result_path(analysis.clip_id).write_text(
        analysis.model_dump_json(indent=2), encoding="utf-8"
    )


def cache_stats() -> dict[str, int]:
    return {
        "clips_indexed": len(load_index()),
        "results_cached": len(list(config.RESULTS_DIR.glob("*.json"))),
    }
