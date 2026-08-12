# SETUP — running this on a fresh machine

The repo contains **code and labels only**. Models, race data and radio clips are
all downloaded by scripts, because together they are ~3 GB and none of it belongs
in version control — see `.gitignore`, and
[What is not in the repo](#what-is-not-in-the-repo) for the command that
regenerates each piece.

Total: about **20 minutes** and **~3 GB** of disk, most of it unattended download.

---

## 0. Prerequisites

| Need | Version | Check |
|---|---|---|
| Python | **3.11 or 3.12** | `python --version` |
| Node.js | 20+ | `node --version` |
| **ffmpeg** | any | `ffmpeg -version` |

**Python 3.13+ will not work.** `torch==2.5.1` and `numpy==1.26.4` publish no
wheels for it — pip fails at install with "no matching distribution". If your
default `python` is newer, install 3.12 alongside and point the venv at it
explicitly (step 1); you do not need to change your system default.

```bash
# macOS
brew install python@3.12
# Windows
winget install --id Python.Python.3.12 -e
# Ubuntu / Debian
sudo apt install -y python3.12 python3.12-venv
```

**ffmpeg is not optional** — every audio library here shells out to it. Install it first:

```bash
# macOS
brew install ffmpeg

# Windows (PowerShell, as admin)
winget install --id Gyan.FFmpeg -e

# Ubuntu / Debian / WSL
sudo apt update && sudo apt install -y ffmpeg
```

On Windows, `winget` adds ffmpeg to PATH but **only for new shells** — open a
fresh terminal before step 1 or `ffmpeg -version` will still fail.

---

## 1. Backend dependencies

```bash
cd grandprix/backend

# Use 3.12 explicitly if your default python is newer:
python3.12 -m venv .venv          # Windows: py -3.12 -m venv .venv
# ...or just `python -m venv .venv` if `python --version` is already 3.11/3.12

# macOS / Linux
source .venv/bin/activate
# Windows
.venv\Scripts\activate

pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

Confirm you got the CPU build and a working interpreter before moving on:

```bash
python -c "import torch, numpy, librosa, transformers, fastf1; print(torch.__version__)"
# want: 2.5.1+cpu   — the '+cpu' suffix is the point
```

The `--extra-index-url` matters: it pulls the **CPU-only** torch wheel (~200 MB)
instead of the CUDA build (~2.5 GB). We have no GPU on the demo laptop, so this
is also the hardware we should be testing on.

*~3 minutes.*

---

## 2. Download the Hugging Face models

```bash
python scripts/warm_models.py
```

Pulls all four models to `~/.cache/huggingface`:

| Model | Size | Fetched by |
|---|---|---|
| `openai/whisper-small` | 927 MB | `warm_models.py` |
| `superb/wav2vec2-base-superb-er` | 722 MB | `warm_models.py` |
| `j-hartmann/emotion-english-distilroberta-base` | 630 MB | `warm_models.py` |
| `istupakov/silero-vad-onnx` | 1.3 MB | `warm_models.py` |

All four are **public — no Hugging Face token needed.** (You still each need an
account for Rule 03; that is separate from anything the code does.)

*~10 minutes on a home connection. Run once — after this the app works offline.*

---

## 3. Download the F1 race data

```bash
python scripts/cache_sessions.py
```

Five real Grands Prix — lap times, sectors, tyre compounds, track status — into
`data/cache/`. Uses official event names; FastF1 silently fuzzy-matches
nicknames to the **wrong race**, so don't edit them to "Monza" or "Interlagos".

*~5 minutes, ~550 MB.*

---

## 4. Download the team radio clips

```bash
python scripts/fetch_radio.py
```

446 real transmissions from the F1 live-timing service, each mapped to a driver
and a lap number, written to `data/clips/` plus `data/clips/index.csv`.

*~5 minutes, ~85 MB. Re-runs skip anything already downloaded.*

> This step loads telemetry (needed for lap timestamps), which temporarily grows
> `data/cache/` to ~1 GB. The lap numbers are baked into `index.csv`, so you
> never need to run it again.

---

## 5. Frontend

```bash
cd ../frontend
npm install
```

*~2 minutes.*

---

## 6. Run it

Two terminals.

**Backend:**
```bash
cd grandprix/backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Windows: .venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**
```bash
cd grandprix/frontend
npm run dev
```

Open **http://localhost:5173**

---

## 7. Verify

```bash
curl http://localhost:8000/api/health
```

You want:
```json
{"status":"ok","offline_ready":true,
 "models_loaded":{"openai/whisper-small":true, ...}}
```

**`offline_ready: true` is the one that matters** — it means weights and race
data are both on local disk, so the app will run at the venue with no wifi.

`offline_ready` reflects all four models (including VAD, which is now warmed
by `warm_models.py`) and the race cache. If any model is missing it shows
`false`.

In the browser you should see a dark dashboard, race and driver pickers, and a
real pace chart. Upload any clip from `data/clips/` to exercise the full
pipeline (~13 s steady-state; models are warmed at startup so the first
upload does not pay the cold-load penalty).

---

## What is not in the repo

`.gitignore` keeps ~3 GB of downloadable and rebuildable files out of git. If you
have just cloned, `data/` looks nearly empty — that is expected. Everything below
is one command away, and steps 1–5 above already run all of them in order.

| Missing after clone | Size | Regenerate with |
|---|---|---|
| `backend/.venv/` | 2.0 GB | step 1 — `pip install -r requirements.txt --extra-index-url …` |
| `~/.cache/huggingface/` | 2.3 GB | step 2 — `python scripts/warm_models.py` |
| `data/cache/` — incl. `fastf1_http_cache.sqlite` | 553 MB | step 3 — `python scripts/cache_sessions.py` |
| `data/clips/*.mp3` | 86 MB | step 4 — `python scripts/fetch_radio.py` |
| `frontend/node_modules/`, `frontend/dist/` | 161 MB | step 5 — `npm install`, `npm run build` |
| `data/results/*.json` | small | re-analyse a clip in the UI; it is only a cache |
| `data/labels/features.json` | varies | `python scripts/fit_fusion.py` |

**Committed on purpose**, despite living in `data/`:

- **`data/clips/index.csv`** — the mp3s beside it are ignored, but this file is
  not. Its `label` column is hand annotation: the one thing here no script can
  reproduce. Losing it means re-listening to 446 clips, so it is whitelisted
  (`!data/clips/index.csv`) and should be committed whenever anyone labels a
  batch. Note that `fetch_radio.py` **appends** to it and skips `clip_id`s it has
  already seen, so re-running the fetch after labelling will not clobber labels.
- **`data/labels/fusion_head.json`** and **`driver_baselines.json`** — a few KB
  each, but rebuilding them needs the full clip set plus a model pass over it.
  Committing them is what lets a fresh clone run a real demo instead of falling
  back to population priors.

The `.sqlite` in `data/cache/` is FastF1's own HTTP request cache, not project
state — there is no database to back up in this project.

---

## Troubleshooting

**`ffmpeg not found`** — step 0. Every audio path depends on it. On Windows,
`winget` only updates PATH for **new** shells: open a fresh terminal.

**`ERROR: No matching distribution found for torch==2.5.1`** — your Python is
3.13+, which has no wheels for these pins. Step 0: install 3.12 and create the
venv with `python3.12 -m venv .venv` (`py -3.12 -m venv .venv` on Windows).

**`UnicodeEncodeError: 'charmap' codec can't encode character '→'`** —
Windows only. The scripts print `→` in their progress output and the console
defaults to cp1252, so this kills `warm_models.py` on its first line. Force
UTF-8:

```bash
# Git Bash
PYTHONUTF8=1 python scripts/warm_models.py
# PowerShell
$env:PYTHONUTF8=1; python scripts/warm_models.py
```

**`huggingface_hub` symlink warning on Windows** — harmless. The cache falls back
to copying files instead of symlinking, using a little more disk. Silence it with
`HF_HUB_DISABLE_SYMLINKS_WARNING=1`, or enable Developer Mode.

**`Port 5173 already in use`** — something is already running. `strictPort` is on
deliberately so it fails loudly rather than drifting to 5174 and leaving you
looking at the wrong page.
```bash
# macOS / Linux
kill $(lsof -ti:5173)
# Windows
netstat -ano | findstr :5173     # then: taskkill /PID <pid> /F
```

**`No sessions cached`** — step 3 didn't finish. Re-run it; it's incremental.

**`offline_ready: false`** — a model or the race cache is missing. Re-run
`warm_models.py` and `cache_sessions.py`.

**Frontend loads but says "Could not load sessions"** — the backend isn't
running, or isn't on port 8000. Vite proxies `/api` there.

**Cloud IDE / dev container** — Vite must bind all interfaces or the port
forward has nothing to attach to. `host: true` is already set in
`vite.config.ts`. Behind an HTTPS proxy, also use `GP_PUBLIC_HTTPS=1 npm run dev`
so hot reload reconnects on 443.

---

## Where things live

```
backend/
  app/pipeline/     preprocess · vad · stt · prosody · ser · text_emotion
                    · baseline · fusion · strategy · leadlag · run
  app/data/         fastf1_client · laps · store · timeline
  app/schemas.py    the API contract — mirrored in frontend/src/types.ts
  scripts/          cache_sessions · fetch_radio · fit_fusion · warm_models
data/                               (git-ignored except where noted)
  cache/            FastF1 sessions        (step 3, ignored)
  clips/            radio audio            (step 4, ignored)
      index.csv     driver/lap/label rows  — COMMITTED, hand annotation
  labels/           features.json ignored; fusion_head.json +
                    driver_baselines.json COMMITTED
  results/          analysis cache         (ignored)
frontend/src/       React dashboard
```

---

## Next step after setup

Nothing is labelled yet and `data/results/` is empty, so scoring runs on
population priors and the lead–lag panel has no data — the UI says so honestly.

**Step A — pre-populate the result cache (run overnight):**

```bash
cd grandprix/backend
python scripts/batch_analyse.py --session 2023-dutch-r
# then run for the other sessions; use --force to re-analyse
```

This writes one JSON per clip to `data/results/`. The lead–lag panel and
strategy feed go live as soon as there are enough results. Expect ~13 s per
clip; 446 clips ≈ 1.5 hours total.

**Step B — label clips and fit the fusion head:**

Open `data/clips/index.csv`, fill the `label` column with **Calm / Stressed /
Tired** for ~80–100 clips, then:

```bash
python scripts/fit_fusion.py
```

That fits per-driver baselines and the fusion head, and prints cross-validated
accuracy against the naive single-model baseline. Commit
`data/labels/fusion_head.json` and `data/labels/driver_baselines.json`.
