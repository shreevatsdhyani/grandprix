"""Driver biometrics upload.

The stress signal in this app comes from voice. Biometrics would be an
independent second channel, and two channels agreeing is evidence where one is a
hypothesis. This is the path for getting real data in.

We have none. Every decision here follows from that: nothing is generated, a
missing file returns 404 rather than an empty series, and parse failures return
the parser's own message so an uploader can fix their file rather than guess.

Not behind GP_AGENT — this is data ingestion, not LLM behaviour, and it should
work in an offline deployment with no Groq key.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.context import biometrics as bio
from app.context import provider as context_provider
from app.schemas import BiometricSeries

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/biometrics", tags=["biometrics"])

# Biometric sessions are a couple of hours at 1Hz — a few hundred KB of CSV. The
# cap is generous for that and still refuses an accidental video upload.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@router.post("", response_model=BiometricSeries)
async def upload_biometrics(
    session_id: str = Form(...),
    driver: str = Form(..., min_length=1, max_length=8),
    file: UploadFile = File(...),
) -> BiometricSeries:
    """Accept a CSV or JSON biometric time series and align it to the session.

    Expected columns: a timestamp (`utc`/`timestamp`/`time`/`ts`) plus any of
    `hr_bpm`, `hrv_ms`, `core_temp_c`. Timestamps may be ISO 8601 or epoch
    seconds. Column aliases are accepted — see `context/biometrics.py`.
    """
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")

    try:
        rows = bio.parse(raw, source=file.filename or "upload")
    except bio.BiometricParseError as exc:
        # The parser's messages are written to be shown to the uploader verbatim.
        raise HTTPException(400, str(exc)) from exc

    lap_for_utc = _lap_resolver(session_id, driver)
    series = bio.build_series(
        rows,
        driver=driver,
        session_id=session_id,
        source=file.filename or "upload",
        lap_for_utc=lap_for_utc,
    )
    context_provider.save_biometrics(series)
    log.info("stored %d biometric samples for %s/%s", series.n_samples, session_id, driver)
    return series


@router.get("/{session_id}", response_model=BiometricSeries)
def read_biometrics(session_id: str, driver: str) -> BiometricSeries:
    series = context_provider.load_biometrics(session_id, driver)
    if series is None:
        raise HTTPException(404, f"No biometrics uploaded for {driver.upper()} in {session_id}.")
    return series


def _lap_resolver(session_id: str, driver: str):
    """A callable mapping a timestamp to a lap number, from the built context.

    Uses the precomputed clip contexts rather than loading FastF1: we only need
    lap boundaries, and paying ~19s of telemetry parse on an upload would be
    absurd. Returns None if no context has been built, in which case samples get
    no lap number — which is honest and costs nothing else.
    """
    ctx = context_provider.get_provider().session_context(session_id)
    if ctx is None:
        return None

    import pandas as pd

    # Lap start times, inferred from the clip contexts we already resolved. Coarse
    # by construction — it is the earliest known instant on each lap, not the true
    # lap start — so a sample near a lap boundary can land on the previous lap.
    marks: list[tuple[pd.Timestamp, int]] = []
    for c in ctx.clip_contexts.values():
        if c.lap is None:
            continue
        ts = pd.to_datetime(c.utc, errors="coerce")
        if ts is pd.NaT or pd.isna(ts):
            continue
        if getattr(ts, "tz", None) is not None:
            ts = ts.tz_convert("UTC").tz_localize(None)
        marks.append((ts, c.lap))
    if not marks:
        return None
    marks.sort()

    def lap_for(when: pd.Timestamp) -> int | None:
        best = None
        for ts, lap in marks:
            if ts <= when:
                best = lap
            else:
                break
        return best

    return lap_for
