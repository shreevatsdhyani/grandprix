"""Serving radio audio to the browser.

The `audio_url` on every ClipAnalysis points here. Without it the player in the
Radio Inspector has nothing to play, which kills the single most important
moment in the demo — pressing play and hearing the driver.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import config
from app.data import store
from app.schemas import ClipSummary

router = APIRouter(prefix="/api/clips", tags=["clips"])

MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


def _find_upload(clip_id: str) -> Path | None:
    """Locate an uploaded clip whatever extension it was saved under."""
    # Uploaded ids are generated (`upload-<hex>`), but this is reached with
    # arbitrary user input, so sanitise before globbing rather than trusting it.
    safe = "".join(ch for ch in clip_id if ch.isalnum() or ch in "-_")
    if not safe:
        return None
    for candidate in sorted((config.CLIPS_DIR / "uploads").glob(f"{safe}.*")):
        if candidate.suffix.lower() in MEDIA_TYPES:
            return candidate
    return None


# Registered BEFORE /{clip_id}: FastAPI matches in declaration order, so a
# literal path defined after the catch-all would be swallowed as a clip id.
@router.get("/library", response_model=list[ClipSummary])
def library(
    session_id: str | None = None,
    driver: str | None = None,
    limit: int = 500,
) -> list[ClipSummary]:
    """The clip library, for the picker in the UI.

    Returns metadata only — no inference. `analysed` says whether pressing a clip
    will answer from the result cache instantly or run the pipeline, which is the
    difference between a two-second demo and a thirteen-second one.
    """
    records = [r for r in store.load_index() if r.exists]
    if session_id:
        records = [r for r in records if r.session_id == session_id]
    if driver:
        records = [r for r in records if r.driver.upper() == driver.upper()]

    # Lap order is the order a race engineer would scan them in; unmapped clips
    # last rather than dropped, since they are still playable and labellable.
    records.sort(key=lambda r: (r.lap is None, r.lap or 0, r.clip_id))

    out: list[ClipSummary] = []
    for r in records[:limit]:
        cached = store.get_cached(r.clip_id)
        out.append(
            ClipSummary(
                clip_id=r.clip_id,
                session_id=r.session_id,
                driver=r.driver.upper(),
                lap=r.lap,
                audio_url=f"/api/clips/{r.clip_id}",
                label=r.label,
                analysed=cached is not None,
                mood=cached.fusion.mood if cached else None,
                stress_index=cached.fusion.stress_index if cached else None,
            )
        )
    return out


@router.get("/{clip_id}")
def get_clip(clip_id: str) -> FileResponse:
    """Stream one clip's audio.

    Resolved through the clip index rather than by joining the id onto a path,
    so a crafted id cannot walk out of the clips directory.
    """
    record = store.find_clip(clip_id)

    if record is not None:
        path = record.path
    else:
        # Uploaded clips are not in the index; they are written to the uploads
        # subdirectory under a generated id, keeping the *original* extension.
        # Assuming .wav here 404'd every mp3/m4a upload — and all 446 curated
        # clips are mp3, so a judge re-uploading one of our own files got a
        # transcript and a mood with a dead player underneath.
        path = _find_upload(clip_id)

    if path is None or not path.is_file():
        raise HTTPException(404, f"No audio on disk for clip {clip_id!r}")

    # Belt and braces: refuse anything that resolved outside the clips tree.
    if not path.resolve().is_relative_to(config.CLIPS_DIR.resolve()):
        raise HTTPException(403, "Refusing to serve a path outside the clips directory")

    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        filename=path.name,
    )


@router.get("")
def list_clips() -> dict[str, object]:
    """What the clip library currently holds.

    Doubles as a collection-progress check: `labelled` against the ~100 clips
    the fusion head needs.
    """
    records = store.load_index()
    labelled = [r for r in records if r.label]
    missing = [r.clip_id for r in records if not r.exists]

    by_label: dict[str, int] = {}
    for r in labelled:
        by_label[r.label] = by_label.get(r.label, 0) + 1

    return {
        "total": len(records),
        "labelled": len(labelled),
        "by_label": by_label,
        "audio_missing": missing,
        **store.cache_stats(),
    }
