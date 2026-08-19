"""How you get context — the seam between historical and live.

Everything above this line in the stack (findings, agent tools, the timeline)
talks to a `RaceContextProvider` and never to a file or an API. That is the whole
point of the abstraction: adding live race support later means writing one new
class here, not touching any consumer.

    CachedRaceContextProvider   reads data/context/{session}.json   (today)
    LiveRaceContextProvider     polls OpenF1 into a rolling buffer  (later)

The cached provider is deliberately dumb — it does no resolution, because
resolution needs FastF1 loaded with telemetry (~19s, ~80MB per session) which
would wreck the timeline endpoint the UI hits on every driver switch.
`scripts/build_context.py` does that work once, offline, and writes the answers
here. That preserves the promise `data/fastf1_client.py` opens with: nothing in
the demo path may depend on a network or a slow parse.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from typing import Protocol

from app import config
from app.schemas import BiometricSeries, ClipContext, SessionContext

log = logging.getLogger(__name__)
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_DRIVER_RE = re.compile(r"^[A-Za-z0-9]+$")


def _safe_join(base, name: str):
    base_resolved = base.resolve()
    path = (base_resolved / name).resolve()
    if not path.is_relative_to(base_resolved):
        raise ValueError("unsafe path")
    return path


class RaceContextProvider(Protocol):
    """What a context source must be able to answer."""

    def session_context(self, session_id: str) -> SessionContext | None:
        """Session-wide context, or None if none has been built."""
        ...

    def clip_context(self, session_id: str, clip_id: str) -> ClipContext | None:
        """Context for one radio call."""
        ...

    def contexts_for_driver(self, session_id: str, driver: str) -> dict[str, ClipContext]:
        """Every clip context for one driver, keyed by clip_id."""
        ...


class CachedRaceContextProvider:
    """Reads precomputed context from `data/context/`.

    Cached in memory after first read, since the timeline endpoint calls this on
    every request and the files are small. Guarded by a lock because uvicorn
    serves requests concurrently and a torn read of a half-populated dict would
    surface as intermittently missing context — the worst kind of bug to chase.
    """

    def __init__(self, context_dir=None) -> None:
        self._dir = context_dir or config.CONTEXT_DIR
        self._cache: dict[str, SessionContext | None] = {}
        self._lock = threading.Lock()

    def _path(self, session_id: str):
        if not _SESSION_ID_RE.fullmatch(session_id):
            raise ValueError("invalid session id")
        return _safe_join(self._dir, f"{session_id}.json")

    def session_context(self, session_id: str) -> SessionContext | None:
        with self._lock:
            if session_id in self._cache:
                return self._cache[session_id]
        try:
            path = self._path(session_id)
        except ValueError:
            log.warning("invalid session id for context lookup: %r", session_id)
            return None
        ctx: SessionContext | None = None
        if path.exists():
            try:
                ctx = SessionContext.model_validate_json(path.read_text())
            except Exception as exc:
                # A malformed context file must not take down the timeline. Log
                # loudly and serve the pre-context view.
                log.error("context file %s unreadable: %s", path, exc)
                ctx = None
        else:
            log.info("no context built for %s — run scripts/build_context.py", session_id)
        with self._lock:
            self._cache[session_id] = ctx
        return ctx

    def clip_context(self, session_id: str, clip_id: str) -> ClipContext | None:
        ctx = self.session_context(session_id)
        return None if ctx is None else ctx.clip_contexts.get(clip_id)

    def contexts_for_driver(self, session_id: str, driver: str) -> dict[str, ClipContext]:
        ctx = self.session_context(session_id)
        if ctx is None:
            return {}
        # Clip ids embed the driver code as `{session}-{DRIVER}-{timestamp}`.
        needle = f"-{driver.upper()}-"
        return {cid: c for cid, c in ctx.clip_contexts.items() if needle in cid}

    def invalidate(self, session_id: str | None = None) -> None:
        """Drop the in-memory cache, so a rebuilt context file is picked up."""
        with self._lock:
            if session_id is None:
                self._cache.clear()
            else:
                self._cache.pop(session_id, None)


def biometrics_path(session_id: str, driver: str):
    if not _SESSION_ID_RE.fullmatch(session_id):
        raise ValueError("invalid session id")
    driver_upper = driver.upper()
    if not _DRIVER_RE.fullmatch(driver_upper):
        raise ValueError("invalid driver")
    return _safe_join(config.BIOMETRICS_DIR, f"{session_id}-{driver_upper}.json")


def load_biometrics(session_id: str, driver: str) -> BiometricSeries | None:
    """Uploaded biometrics for one driver, or None.

    None means no data. It never means zero — see `context/biometrics.py` for why
    that distinction is load-bearing.
    """
    try:
        path = biometrics_path(session_id, driver)
    except ValueError:
        log.warning("invalid biometrics lookup: session=%r driver=%r", session_id, driver)
        return None
    if not path.exists():
        return None
    try:
        return BiometricSeries.model_validate_json(path.read_text())
    except Exception as exc:
        log.error("biometrics file %s unreadable: %s", path, exc)
        return None


def save_biometrics(series: BiometricSeries) -> None:
    path = biometrics_path(series.session_id, series.driver)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(series.model_dump_json(indent=2))


_provider: CachedRaceContextProvider | None = None


def get_provider() -> CachedRaceContextProvider:
    """Module-level singleton, matching `routers.agent_cache.get_cache()`."""
    global _provider
    if _provider is None:
        _provider = CachedRaceContextProvider()
    return _provider
