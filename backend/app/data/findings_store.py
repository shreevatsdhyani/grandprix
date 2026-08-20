"""On-disk store for LLM-authored top findings.

Why a file and not just the in-memory cache in `routers/agent_cache.py`:

The chat agent's cache is right for chat. A question is one of infinitely many,
asked once, and an hour-old answer to a question nobody will ask again is not
worth a file. Findings are the opposite — there is exactly one briefing per
(session, driver, mode), the inputs are fixed race data that will never change,
and every driver in every race will eventually be looked at. An in-memory cache
with a one-hour TTL means the same twenty drivers get their briefing rewritten
every hour and again after every backend restart, so the panel spends most of its
life showing a spinner for an answer it has already produced.

So: write it down. Same key, no TTL. A stored briefing is only replaced when the
caller explicitly asks with `?refresh=true`, which is also the escape hatch for
when the prompt or model changes and the old text is no longer what we would
write today.

Reads never raise. A corrupt or partially-written file is treated as a miss and
regenerated, because a broken cache entry should cost a slow request rather than
a 500.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from app import config

log = logging.getLogger(__name__)

# Session ids and driver codes both come off the wire. They are already length-
# and pattern-constrained by the router's Query validators, but this store turns
# them into a filesystem path, so it re-checks rather than trusting: one
# traversal sequence in a driver code would otherwise write outside the data dir.
_SAFE = re.compile(r"[^A-Za-z0-9_-]")


def _path(session_id: str, driver: str, mode: str) -> Path:
    parts = [_SAFE.sub("_", p) for p in (session_id, driver.upper(), mode)]
    return config.FINDINGS_DIR / f"{'-'.join(parts)}.json"


def load(session_id: str, driver: str, mode: str) -> dict[str, Any] | None:
    """Return the stored findings payload, or None if absent or unreadable."""
    path = _path(session_id, driver, mode)
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Discarding unreadable findings cache %s: %s", path.name, exc)
        return None
    if not isinstance(payload, dict) or "findings" not in payload:
        log.warning("Discarding malformed findings cache %s", path.name)
        return None
    return payload


def save(session_id: str, driver: str, mode: str, payload: dict[str, Any]) -> None:
    """Write the findings payload, atomically.

    Atomic because the alternative is a reader seeing a half-written file and
    then a permanent cache miss until someone notices. A failed write is logged
    and swallowed: not being able to cache is not a reason to fail the request
    that produced a perfectly good answer.
    """
    path = _path(session_id, driver, mode)
    tmp = path.with_suffix(".json.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except OSError as exc:
        log.warning("Could not cache findings to %s: %s", path.name, exc)
        tmp.unlink(missing_ok=True)
