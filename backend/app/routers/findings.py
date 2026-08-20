"""Top findings — the LLM's ranked reading of a whole session.

Mounted behind GP_AGENT, the same flag as /api/agent/ask, so a deployment without
a Groq key 404s consistently rather than exposing an endpoint that always 500s.
The frontend uses that 404 to hide the panel.

Cached twice, on purpose. The in-memory store shared with the chat agent absorbs
the repeat traffic inside one process; `data/findings_store.py` writes the answer
to disk so it survives restarts and so every driver in every race is generated at
most once ever. Findings are expensive (one large prompt) and completely
deterministic in their inputs, so a cache hit is free correctness rather than a
shortcut. `?refresh=true` bypasses and overwrites both.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app.data import findings_store, timeline as timeline_module
from app.pipeline import findings as findings_module
from app.routers.agent_cache import get_cache
from app.schemas import FindingsResponse, ScoringMode

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/findings", tags=["findings"])

# The cache is keyed on a question string; this stands in for one.
_CACHE_MARKER = "__top_findings__"


@router.get("/{session_id}", response_model=FindingsResponse)
def get_findings(
    session_id: str,
    driver: str = Query(..., min_length=1, max_length=8),
    mode: ScoringMode = ScoringMode.FUSION,
    refresh: bool = Query(False, description="Bypass the cache and regenerate"),
) -> FindingsResponse:
    cache_key = f"{_CACHE_MARKER}:{mode.value}"
    cache = get_cache()

    if not refresh:
        cached = cache.get(cache_key, session_id, driver)
        if cached is not None:
            return FindingsResponse(**{**cached, "cached": True})

        # Disk next. Promoted into memory on the way out so the next reader in
        # this process does not touch the filesystem either.
        stored = findings_store.load(session_id, driver, mode.value)
        if stored is not None:
            cache.set(cache_key, session_id, driver, stored)
            return FindingsResponse(**{**stored, "cached": True})

    try:
        tl = timeline_module.build(session_id, driver, mode)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc

    try:
        result = findings_module.generate(tl, mode)
    except findings_module.FindingsUnavailable as exc:
        # 503 rather than 500: the analysis pipeline is fine, the generation step
        # is not available right now. The distinction matters to the frontend,
        # which should say "findings unavailable" rather than "something broke".
        raise HTTPException(503, str(exc)) from exc

    payload = result.model_dump(mode="json")
    cache.set(cache_key, session_id, driver, payload)
    findings_store.save(session_id, driver, mode.value, payload)
    return result
