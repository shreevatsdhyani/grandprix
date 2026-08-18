"""FastF1 access, cache-only.

Everything here reads from the on-disk cache populated by
`scripts/cache_sessions.py`. The GrandPrix round is offline and we assume venue
wifi fails, so a cache miss is treated as an error rather than quietly reaching
for the network.
"""

from __future__ import annotations

import functools
import logging
import re
import unicodedata
import warnings

import fastf1
import pandas as pd

from app import config
from app.schemas import SessionMeta

log = logging.getLogger(__name__)

# FastF1 is chatty at INFO and emits Ergast warnings on every load. Neither is
# actionable for us, and both drown the uvicorn log during a demo.
logging.getLogger("fastf1").setLevel(logging.WARNING)
warnings.filterwarnings("ignore", module="fastf1")

fastf1.Cache.enable_cache(str(config.FASTF1_CACHE_DIR))

# Sessions we ship. Must match scripts/cache_sessions.py — official event names
# only, because FastF1 silently fuzzy-matches nicknames to the wrong race.
AVAILABLE = [
    (2024, "British Grand Prix", "R"),
    (2024, "Italian Grand Prix", "R"),
    (2024, "Singapore Grand Prix", "R"),
    (2024, "Monaco Grand Prix", "R"),
    (2023, "Dutch Grand Prix", "R"),
    (2023, "São Paulo Grand Prix", "R"),
    (2023, "Bahrain Grand Prix", "R"),
    (2023, "Monaco Grand Prix", "R"),
    (2023, "Singapore Grand Prix", "R"),
]


def make_session_id(year: int, event_name: str, kind: str) -> str:
    """`2024 British Grand Prix R` -> `2024-british-r`.

    Stable, URL-safe, and human-readable in a log line. Drops the "grand prix"
    noise so ids stay short.
    """
    slug = event_name.lower()
    slug = re.sub(r"\bgrand prix\b", "", slug)
    # Decompose accents to base letter + combining mark, then drop the marks, so
    # "São Paulo" becomes "sao-paulo". A plain ascii encode would delete the "ã"
    # outright and yield "so-paulo".
    slug = unicodedata.normalize("NFKD", slug).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return f"{year}-{slug}-{kind.lower()}"


@functools.lru_cache(maxsize=8)
def load_session(session_id: str) -> fastf1.core.Session:
    """Load one cached session. Cached in-process: parsing costs a few seconds
    and the demo switches drivers repeatedly on the same race.
    """
    for year, event, kind in AVAILABLE:
        if make_session_id(year, event, kind) == session_id:
            session = fastf1.get_session(year, event, kind)
            # telemetry=False keeps this to lap-level data — it is all we need
            # and it keeps load times in the low seconds.
            session.load(laps=True, telemetry=False, weather=False, messages=True)
            return session
    raise KeyError(f"Unknown session {session_id!r}")


@functools.lru_cache(maxsize=1)
def list_sessions() -> list[SessionMeta]:
    """Sessions present in the local cache. Anything that fails to load is
    omitted rather than raising, so one bad cache entry can't take down the
    whole picker mid-demo.
    """
    out: list[SessionMeta] = []
    for year, event, kind in AVAILABLE:
        sid = make_session_id(year, event, kind)
        try:
            session = load_session(sid)
            drivers = sorted(session.laps["Driver"].dropna().unique().tolist())
            out.append(
                SessionMeta(
                    session_id=sid,
                    year=year,
                    event_name=event,
                    session_type=kind,
                    drivers=drivers,
                    cached=True,
                )
            )
        except Exception as exc:
            log.warning("Session %s unavailable: %s", sid, exc)
    return out


def driver_laps(session_id: str, driver: str) -> pd.DataFrame:
    """Raw lap frame for one driver, as FastF1 returns it."""
    session = load_session(session_id)
    laps = session.laps.pick_drivers(driver)
    if laps.empty:
        raise KeyError(f"No laps for driver {driver!r} in {session_id!r}")
    return laps.reset_index(drop=True)
