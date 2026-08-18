#!/usr/bin/env python3
"""Extract real circuit outlines from the cached FastF1 position data.

Emits an SVG path per session, normalised into a 1000x1000 box, so the frontend
can draw the actual track geometry instead of a hand-drawn approximation.

Usage:
    python scripts/extract_circuits.py                    # every cached session
    python scripts/extract_circuits.py 2023-monaco-r ...  # only these ids

Emitting one session at a time matters: `session.load(telemetry=True)` pulls the
full position stream, which is minutes and ~120 MB per race on a cold cache. The
runtime app never does this — see `app.data.fastf1_client`, which loads with
telemetry=False.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import fastf1  # noqa: E402
import numpy as np  # noqa: E402

from app import config  # noqa: E402

# The session list is not duplicated here on purpose. It used to be a local copy
# that silently went stale at five entries while the app grew to nine, so four
# circuits had no geometry at all. There is one list, and it lives with the code
# that serves it.
from app.data.fastf1_client import AVAILABLE, make_session_id  # noqa: E402

fastf1.Cache.enable_cache(str(config.FASTF1_CACHE_DIR))

SESSIONS = [
    (make_session_id(year, event, kind), year, event, kind)
    for year, event, kind in AVAILABLE
]


def resample(x: np.ndarray, y: np.ndarray, n: int = 460) -> tuple[np.ndarray, np.ndarray]:
    """Even-arc-length resample so the path has uniform point density."""
    d = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    t = np.linspace(0, d[-1], n)
    return np.interp(t, d, x), np.interp(t, d, y)


def to_path(x: np.ndarray, y: np.ndarray) -> tuple[str, float]:
    """Normalise into a 1000-wide box (aspect preserved) and emit an SVG path."""
    x = x - x.min()
    y = y - y.min()
    span = max(x.max(), y.max())
    scale = 1000.0 / span
    x = x * scale
    y = y * scale
    # SVG y grows downward; FastF1 y grows upward.
    y = y.max() - y
    pts = [f"{px:.1f} {py:.1f}" for px, py in zip(x, y)]
    return "M" + "L".join(pts) + "Z", round(float(y.max()), 1)


wanted = sys.argv[1:]
if wanted:
    known = {sid for sid, *_ in SESSIONS}
    unknown = [w for w in wanted if w not in known]
    if unknown:
        sys.exit(
            f"Unknown session id(s): {', '.join(unknown)}\n"
            f"Known: {', '.join(sorted(known))}"
        )
    targets = [row for row in SESSIONS if row[0] in wanted]
else:
    targets = SESSIONS

out = {}
for sid, year, event, kind in targets:
    s = fastf1.get_session(year, event, kind)
    s.load(laps=True, telemetry=True, weather=False, messages=False)
    lap = s.laps.pick_fastest()
    pos = lap.get_pos_data()
    x = pos["X"].to_numpy(dtype=float)
    y = pos["Y"].to_numpy(dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    x, y = resample(x, y)
    path, height = to_path(x, y)
    out[sid] = {
        "path": path,
        "height": height,
        "laps": int(s.total_laps) if getattr(s, "total_laps", None) else None,
        "event": s.event["EventName"],
        "country": s.event["Country"],
        "location": s.event["Location"],
    }
    print(f"{sid}: {len(path)} chars, height {height}, {out[sid]['country']}", file=sys.stderr)

print(json.dumps(out, ensure_ascii=False))
