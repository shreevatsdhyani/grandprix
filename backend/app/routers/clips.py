"""Serving radio audio to the browser.

The `audio_url` on every ClipAnalysis points here. Without it the player in the
Radio Inspector has nothing to play, which kills the single most important
moment in the demo — pressing play and hearing the driver.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import config
from app.data import store

router = APIRouter(prefix="/api/clips", tags=["clips"])

MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


@router.get("/{clip_id}")
def get_clip(clip_id: str) -> FileResponse:
    """Stream one clip's audio.

    Resolved through the clip index rather than by joining the id onto a path,
    so a crafted id cannot walk out of the clips directory.
    """
    record = store.find_clip(clip_id)

    # Uploaded clips are not in the index; they are written to the uploads
    # subdirectory under a generated id.
    path = record.path if record else config.CLIPS_DIR / "uploads" / f"{clip_id}.wav"

    if not path.is_file():
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
