#!/usr/bin/env python3
"""Extract real circuit outlines from the cached FastF1 position data.

Emits an SVG path per session, normalised into a 1000x1000 box, so the frontend
can draw the actual track geometry instead of a hand-drawn approximation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path("/Users/akshatsaraswat/Desktop/grandprix")
sys.path.insert(0, str(ROOT / "backend"))

import fastf1  # noqa: E402
import numpy as np  # noqa: E402

fastf1.Cache.enable_cache(str(ROOT / "data" / "cache"))

# Must stay in step with `app/data/fastf1_client.AVAILABLE`. A session missing here
# has no outline, so the frontend circuit map and the "where it happened" trace both
# fall back to nothing for it.
SESSIONS = [
    ("2024-british-r", 2024, "British Grand Prix", "R"),
    ("2024-italian-r", 2024, "Italian Grand Prix", "R"),
    ("2024-singapore-r", 2024, "Singapore Grand Prix", "R"),
    ("2024-monaco-r", 2024, "Monaco Grand Prix", "R"),
    ("2023-dutch-r", 2023, "Dutch Grand Prix", "R"),
    ("2023-sao-paulo-r", 2023, "São Paulo Grand Prix", "R"),
    ("2023-bahrain-r", 2023, "Bahrain Grand Prix", "R"),
    ("2023-monaco-r", 2023, "Monaco Grand Prix", "R"),
    ("2023-singapore-r", 2023, "Singapore Grand Prix", "R"),
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


out = {}
for sid, year, event, kind in SESSIONS:
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
