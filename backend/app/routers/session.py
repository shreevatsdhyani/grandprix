"""Session, timeline and lap data.

Two backends behind one contract:

  GP_USE_FIXTURES=1  synthetic data, for frontend work before the pipeline lands
  GP_USE_FIXTURES=0  real FastF1 laps + analysed clips

The response shape is identical either way, so switching is a restart, not a
refactor.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app import config
from app.data import fastf1_client, timeline as timeline_builder
from app.fixtures import demo
from app.schemas import Lap, ScoringMode, SessionMeta, Timeline

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["session"])


@router.get("/sessions", response_model=list[SessionMeta])
def list_sessions() -> list[SessionMeta]:
    """Races available offline. Populated by `scripts/cache_sessions.py`."""
    if config.USE_FIXTURES:
        return [demo.DEMO_SESSION]
    sessions = fastf1_client.list_sessions()
    if not sessions:
        raise HTTPException(
            503, "No sessions cached. Run: python scripts/cache_sessions.py"
        )
    return sessions


@router.get("/timeline/{session_id}", response_model=Timeline)
def timeline(
    session_id: str,
    driver: str = Query("HAM", min_length=2, max_length=3, description="Driver code"),
    mode: ScoringMode = Query(ScoringMode.FUSION, description="Drives the A/B toggle"),
) -> Timeline:
    """The hero chart's payload: pace delta, stress overlay, clips, strategy calls.

    `mode` is a query param rather than two endpoints so the UI toggle is a
    single refetch and both paths are provably served by the same code.
    """
    if config.USE_FIXTURES:
        if session_id != demo.DEMO_SESSION.session_id:
            raise HTTPException(404, f"Unknown session {session_id!r}")
        return demo.build_timeline(driver=driver, mode=mode)

    try:
        return timeline_builder.build(session_id, driver, mode)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/laps/{session_id}", response_model=list[Lap])
def laps(
    session_id: str,
    driver: str = Query(..., min_length=2, max_length=3),
) -> list[Lap]:
    """Raw lap deltas without any audio analysis.

    Useful on its own: it renders the pace panel even when no clips have been
    analysed yet, and it is the endpoint to check when a chart looks wrong.
    """
    if config.USE_FIXTURES:
        raise HTTPException(501, "Set GP_USE_FIXTURES=0 for real lap data")
    try:
        from app.data.laps import lap_series

        return lap_series(session_id, driver.upper())
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
