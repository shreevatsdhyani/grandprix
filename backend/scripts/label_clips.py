#!/usr/bin/env python3
"""Interactive clip labelling tool.

Opens a browser-based UI: one clip at a time, audio player, three buttons.
Labels are saved back to the output CSV immediately on every keypress.

    python scripts/label_clips.py                          # all unlabelled clips → index.csv
    python scripts/label_clips.py --session 2023-dutch-r   # one session only
    python scripts/label_clips.py --driver HAM             # one driver only
    python scripts/label_clips.py --relabel                # include already-labelled clips too
    python scripts/label_clips.py --output index_c.csv     # Person C: write to separate file

Keyboard shortcuts in the browser:
    1  →  Calm
    2  →  Stressed
    3  →  Tired
    s  →  Skip (leave blank, move on)
    Space  →  play / pause
    ←  →  go back one clip

Port 5050 — open http://localhost:5050 after starting.
"""

from __future__ import annotations

import argparse
import csv
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402

INDEX_CSV = config.CLIPS_DIR / "index.csv"
CLIPS_DIR = config.CLIPS_DIR

# ──────────────────────────────────────────────────────────────────────────────
# CSV helpers — fieldnames are read from the file header, never hardcoded
# ──────────────────────────────────────────────────────────────────────────────

def load_index(path: Path) -> tuple[list[dict], list[str]]:
    """Return (rows, fieldnames). fieldnames preserves the original column order."""
    if not path.exists():
        # Person C starting fresh: copy structure from index.csv
        src = INDEX_CSV
        if not src.exists():
            return [], []
        with src.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            rows = list(reader)
        return rows, fieldnames
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    return rows, fieldnames


def save_index(rows: list[dict], path: Path, fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def find_audio(row: dict) -> Path | None:
    # Primary: use the filename column (actual column name in index.csv)
    fname = row.get("filename", "")
    if fname:
        p = CLIPS_DIR / fname
        if p.exists():
            return p
    # Fallback: glob by clip_id with any audio extension
    clip_id = row.get("clip_id", "")
    for ext in (".mp3", ".wav", ".m4a", ".ogg", ".flac"):
        candidate = CLIPS_DIR / f"{clip_id}{ext}"
        if candidate.exists():
            return candidate
    return None


# ──────────────────────────────────────────────────────────────────────────────
# HTML template
# ──────────────────────────────────────────────────────────────────────────────

HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Label clips — The Silent Co-Driver</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d0d; color: #e5e5e5; font-family: 'Segoe UI', system-ui, sans-serif;
         display: flex; flex-direction: column; align-items: center; min-height: 100vh;
         padding: 2rem 1rem; gap: 1.5rem; }
  h1 { font-size: 1rem; font-weight: 700; letter-spacing: .15em; text-transform: uppercase;
       color: #e5e5e5; }
  .progress { font-size: .75rem; color: #888; letter-spacing: .05em; }
  .progress b { color: #e5e5e5; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
          padding: 1.5rem 2rem; width: 100%; max-width: 560px; }
  .meta { display: flex; gap: 1rem; font-size: .72rem; color: #888; margin-bottom: 1rem;
          flex-wrap: wrap; }
  .meta span { background: #252525; border-radius: 4px; padding: .25rem .6rem; }
  .meta span b { color: #ccc; }
  audio { width: 100%; margin-bottom: 1.25rem; accent-color: #e10600; }
  .buttons { display: flex; gap: .75rem; }
  button { flex: 1; padding: .75rem; border: 1px solid #333; border-radius: 6px;
           background: #222; color: #ccc; font-size: .82rem; font-weight: 600;
           letter-spacing: .06em; text-transform: uppercase; cursor: pointer;
           transition: background .12s, color .12s, border-color .12s; }
  button:hover, button:focus { outline: none; }
  #btn-calm:hover, #btn-calm.active     { background: #14532d; border-color: #22c55e; color: #86efac; }
  #btn-stressed:hover, #btn-stressed.active { background: #7f1d1d; border-color: #ef4444; color: #fca5a5; }
  #btn-tired:hover, #btn-tired.active   { background: #1e3a5f; border-color: #60a5fa; color: #bfdbfe; }
  #btn-skip:hover, #btn-skip.active     { background: #2a2a2a; border-color: #666; color: #aaa; }
  .hint { font-size: .68rem; color: #555; text-align: center; }
  .hint kbd { background: #222; border: 1px solid #444; border-radius: 3px;
              padding: 0 .3rem; color: #999; }
  .done-banner { font-size: 1.25rem; font-weight: 700; color: #22c55e; text-align: center; }
  .done-banner p { font-size: .85rem; color: #888; font-weight: 400; margin-top: .5rem; }
  .toast { position: fixed; bottom: 1.5rem; right: 1.5rem; background: #1e3a5f;
           border: 1px solid #60a5fa; border-radius: 6px; padding: .5rem 1rem;
           font-size: .78rem; color: #bfdbfe; opacity: 0; transition: opacity .3s;
           pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<h1>Silent Co-Driver — Label clips</h1>
<div class="progress" id="progress">Loading…</div>

<div class="card" id="main-card">
  <div class="meta" id="meta"></div>
  <audio id="player" controls preload="auto"></audio>
  <div class="buttons">
    <button id="btn-calm"     onclick="label('Calm')">1 — Calm</button>
    <button id="btn-stressed" onclick="label('Stressed')">2 — Stressed</button>
    <button id="btn-tired"    onclick="label('Tired')">3 — Tired</button>
    <button id="btn-skip"     onclick="label('')">S — Skip</button>
  </div>
</div>

<div class="hint">
  <kbd>1</kbd> Calm &nbsp; <kbd>2</kbd> Stressed &nbsp; <kbd>3</kbd> Tired &nbsp;
  <kbd>S</kbd> Skip &nbsp; <kbd>Space</kbd> Play/pause &nbsp; <kbd>←</kbd> Previous
</div>

<div class="toast" id="toast"></div>

<script>
let current = null;

async function loadClip() {
  const res = await fetch('/api/current');
  const data = await res.json();
  if (data.done) {
    document.getElementById('main-card').innerHTML =
      '<div class="done-banner">All clips labelled!<p>Close this window and commit the CSV.</p></div>';
    document.getElementById('progress').textContent = 'Done';
    return;
  }
  current = data;
  document.getElementById('progress').innerHTML =
    `<b>${data.index + 1}</b> of <b>${data.total}</b> &nbsp;·&nbsp; ` +
    `<b>${data.labelled}</b> labelled so far`;
  const meta = document.getElementById('meta');
  meta.innerHTML = [
    ['Session', data.session_id],
    ['Driver', data.driver],
    ['Lap', data.lap ?? '—'],
    ['Clip', data.clip_id],
  ].map(([k, v]) => `<span><b>${k}:</b> ${v}</span>`).join('');
  const player = document.getElementById('player');
  player.src = `/api/audio/${encodeURIComponent(data.clip_id)}`;
  player.load();
  player.play().catch(() => {});
  ['calm','stressed','tired','skip'].forEach(b =>
    document.getElementById('btn-' + b).classList.remove('active'));
  if (data.existing_label !== undefined) {
    const map = {'Calm':'calm','Stressed':'stressed','Tired':'tired','':'skip'};
    const b = document.getElementById('btn-' + (map[data.existing_label] ?? 'skip'));
    if (b) b.classList.add('active');
  }
}

async function label(value) {
  if (!current) return;
  await fetch('/api/label', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({clip_id: current.clip_id, label: value}),
  });
  showToast(value === '' ? 'Skipped' : value);
  loadClip();
}

async function prev() {
  await fetch('/api/prev', {method:'POST'});
  loadClip();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 800);
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '1') label('Calm');
  else if (e.key === '2') label('Stressed');
  else if (e.key === '3') label('Tired');
  else if (e.key === 's' || e.key === 'S') label('');
  else if (e.key === ' ') {
    e.preventDefault();
    const p = document.getElementById('player');
    p.paused ? p.play() : p.pause();
  }
  else if (e.key === 'ArrowLeft') prev();
});

loadClip();
</script>
</body>
</html>
"""

# ──────────────────────────────────────────────────────────────────────────────
# Server
# ──────────────────────────────────────────────────────────────────────────────

def run_server(
    queue: list[dict],
    all_rows: list[dict],
    fieldnames: list[str],
    output_path: Path,
    port: int,
) -> None:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import HTMLResponse, Response
    from pydantic import BaseModel
    import uvicorn

    app = FastAPI()

    state = {"idx": 0}

    @app.get("/", response_class=HTMLResponse)
    def index():
        return HTML

    @app.get("/api/current")
    def current():
        idx = state["idx"]
        if idx >= len(queue):
            labelled = sum(1 for r in all_rows if r.get("label", "").strip())
            return {"done": True, "labelled": labelled, "total": len(queue)}
        row = queue[idx]
        labelled = sum(1 for r in all_rows if r.get("label", "").strip())
        return {
            "done": False,
            "clip_id": row["clip_id"],
            "session_id": row["session_id"],
            "driver": row["driver"],
            "lap": row.get("lap") or None,
            "existing_label": row.get("label", ""),
            "index": idx,
            "total": len(queue),
            "labelled": labelled,
        }

    @app.get("/api/audio/{clip_id}")
    def audio(clip_id: str):
        row = next((r for r in all_rows if r["clip_id"] == clip_id), None)
        if row is None:
            raise HTTPException(404, "clip not found")
        path = find_audio(row)
        if path is None:
            raise HTTPException(404, f"audio file not found for {clip_id}")
        MEDIA = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".ogg": "audio/ogg",
            ".flac": "audio/flac",
        }
        ct = MEDIA.get(path.suffix.lower(), "audio/mpeg")
        return Response(content=path.read_bytes(), media_type=ct)

    class LabelRequest(BaseModel):
        clip_id: str
        label: str

    @app.post("/api/label")
    def save_label(req: LabelRequest):
        if req.label not in {"Calm", "Stressed", "Tired", ""}:
            raise HTTPException(400, "label must be Calm, Stressed, Tired, or empty")
        for row in all_rows:
            if row["clip_id"] == req.clip_id:
                row["label"] = req.label
                break
        save_index(all_rows, output_path, fieldnames)
        state["idx"] += 1
        return {"ok": True}

    @app.post("/api/prev")
    def go_prev():
        state["idx"] = max(0, state["idx"] - 1)
        return {"idx": state["idx"]}

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="error")


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Clip labelling UI")
    parser.add_argument("--session", help="Filter to one session_id")
    parser.add_argument("--driver", help="Filter to one driver (3-letter code)")
    parser.add_argument("--relabel", action="store_true",
                        help="Include already-labelled clips (default: unlabelled only)")
    parser.add_argument("--output", default=None,
                        help="CSV file to write labels into (default: data/clips/index.csv). "
                             "Person C should pass: --output data/clips/index_c.csv")
    parser.add_argument("--port", type=int, default=5050)
    args = parser.parse_args()

    output_path = Path(args.output) if args.output else INDEX_CSV
    if not output_path.is_absolute():
        output_path = Path(__file__).resolve().parent.parent / output_path

    all_rows, fieldnames = load_index(output_path)
    if not all_rows:
        print(f"No clips found in {output_path} — run fetch_radio.py first.")
        sys.exit(1)

    queue = all_rows[:]
    if args.session:
        queue = [r for r in queue if r.get("session_id") == args.session]
    if args.driver:
        queue = [r for r in queue if r.get("driver", "").upper() == args.driver.upper()]
    if not args.relabel:
        queue = [r for r in queue if not r.get("label", "").strip()]

    def sort_key(r: dict):
        lap = r.get("lap")
        try:
            lap_n = int(lap) if lap else 9999
        except (ValueError, TypeError):
            lap_n = 9999
        return (r.get("session_id", ""), r.get("driver", ""), lap_n)

    queue.sort(key=sort_key)

    if not queue:
        label_word = "unlabelled " if not args.relabel else ""
        print(f"No {label_word}clips match the filter. Nothing to label.")
        sys.exit(0)

    already = sum(1 for r in all_rows if r.get("label", "").strip())
    print(f"Labelling tool — {len(queue)} clips queued  ({already} already labelled in this file)")
    print(f"  Filter : session={args.session or 'all'}  driver={args.driver or 'all'}")
    print(f"  Saving : {output_path}")
    print()
    url = f"http://localhost:{args.port}"
    print(f"  Opening {url}")
    print("  Keys: 1=Calm  2=Stressed  3=Tired  S=Skip  Space=play/pause  ←=previous")
    print("  Ctrl-C to stop (labels already saved)")
    print()

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    run_server(queue, all_rows, fieldnames, output_path, args.port)


if __name__ == "__main__":
    main()
