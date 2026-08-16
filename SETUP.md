# SETUP

The repo holds **code, labels, and trained weights only**. Models, race data and
radio clips (~3 GB) are downloaded by scripts — see [What's not in the repo](#whats-not-in-the-repo).

**Budget ~45 minutes**, most of it unattended download.

---

## 0. Prerequisites

| Need | Version | Check |
|---|---|---|
| Python | **3.11 or 3.12** | `python3 --version` |
| Node.js | 20+ | `node --version` |
| ffmpeg | any | `ffmpeg -version` |

**Python version is the #1 setup failure.** Both ends of the range break:

- **3.13+** → `torch==2.5.1` and `numpy==1.26.4` publish no wheels.
- **3.9 or older** → `onnxruntime==1.20.1` publishes no wheels (1.19.2 was its last 3.9 release). macOS is the usual victim: `/usr/bin/python3` is 3.9, so a bare `python3 -m venv` silently builds an unusable venv and pip fails halfway through with `No matching distribution found for onnxruntime==1.20.1`.

**Do not rely on your default `python3`.** Name the version explicitly in step 1.

```bash
# macOS
brew install python@3.12 ffmpeg
# Ubuntu / Debian
sudo apt install -y python3.12 python3.12-venv ffmpeg
# Windows (PowerShell as admin) — reopen the terminal afterwards for PATH
winget install --id Python.Python.3.12 -e; winget install --id Gyan.FFmpeg -e
```

---

## 1. Backend dependencies · ~3 min

```bash
cd grandprix/backend

python3.12 -m venv .venv        # Windows: py -3.12 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip

pip install -r requirements.txt
```

Verify before continuing — **if this prints 3.9 or 3.13, stop and rebuild the venv**:

```bash
python --version                # want: 3.11.x or 3.12.x
python -c "import torch, librosa, transformers, fastf1, onnxruntime, dotenv; print(torch.__version__)"
```

On Linux/Windows, add `--extra-index-url https://download.pytorch.org/whl/cpu` to
get the 200 MB CPU wheel instead of the 2.5 GB CUDA build. On macOS arm64 the
default wheel is already CPU-only, so it makes no difference.

---

## 2–4. Download models, race data, clips · ~20 min

```bash
python scripts/warm_models.py      # 4 HF models → ~/.cache/huggingface   (~2.3 GB)
python scripts/cache_sessions.py   # 5 races → data/cache/                (~550 MB)
python scripts/fetch_radio.py      # 446 mp3s → data/clips/               (~86 MB)
```

All four models are public — no HF token needed. Every script is incremental:
safe to interrupt, re-runs skip what already exists.

Don't rename the events in `cache_sessions.py` — FastF1 fuzzy-matches nicknames
like "Monza" to the **wrong race** without erroring.

---

## 5. Frontend · ~2 min

```bash
cd ../frontend && npm install
```

---

## 6. Analyse the clips · ~30 min — **REQUIRED**

```bash
cd ../backend
python scripts/batch_analyse.py            # all 446 clips
```

**This step is not optional, despite what you may assume from the name.** Steps
2–4 download *lap times and audio*. Neither computes stress. The timeline only
plots clips that already have a cached analysis in `data/results/`, so skipping
this gives you a working app with **three empty panels**:

- no stress line on the hero chart,
- lead-lag panel reads "not enough radio calls",
- strategy feed blank,
- chatbot answers *"I don't have access to that data"* to everything.

That is the single most common "the UI shows nothing" report. If your dashboard
looks empty, check `ls data/results/ | wc -l` before debugging anything else.

Safe to interrupt; cached clips are skipped on re-run. Panels fill in
**progressively** — refresh the browser as it goes, no restart needed. Clips are
processed driver-alphabetically across all five sessions at once, so HAM and VER
land last; watch `2023-dutch-r` + `ALO` if you want to see it working early.

```bash
python scripts/batch_analyse.py --session 2023-dutch-r   # just one session (172 clips, ~12 min)
python scripts/batch_analyse.py --force                  # re-analyse cached
```

Whisper prints `FutureWarning`, an SDPA attention fallback, and the occasional
`Word timestamps unavailable; falling back to plain decode`. All noise — results
are written regardless.

---

## 7. Chatbot · optional

Create `backend/.env` with two lines — get a free key at https://console.groq.com/keys:

```
GROQ_API_KEY=gsk_your_key_here
GP_AGENT=1
```

There is no `.env.example` in the repo. Both `.env` and `.env.*` are gitignored
on purpose: the template file previously carried a real key, which is the usual
way secrets escape — a file named "example" reads as inert and nobody checks it.

Without `.env`, the agent route isn't registered at all and the chatbot button
never appears. `.env` is read at import, so **restart uvicorn after creating it**.

> `httpx` is pinned to `0.27.2` in `requirements.txt` on purpose. `groq==0.11.0`
> passes `proxies=` to `httpx.Client()`, which **httpx 0.28 removed**. Unpinned,
> pip resolves to 0.28.x and every chatbot request returns 500 at client
> construction. Don't unpin it without also upgrading `groq`.

---

## 8. Run it — two terminals

**Backend:**
```bash
cd grandprix/backend
source .venv/bin/activate       # Windows: .venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**
```bash
cd grandprix/frontend
npm run dev
```

**Dashboard** → http://localhost:5173 · **API docs** → http://localhost:8000/docs

`app.main` resolves relative to the working directory — run uvicorn from
`backend/`, not `backend/scripts/`, or you get `ModuleNotFoundError: No module
named 'app'`.

---

## 9. Verify

```bash
curl http://localhost:8000/api/health          # want: "offline_ready": true, 4 models true
ls data/results/ | wc -l                       # want: 446
curl "http://localhost:8000/api/timeline/2023-dutch-r?driver=ALO"   # want: points[] with stress_index
```

In the browser: session picker lists 5 races, timeline shows a pace line **and**
a stress band, radio inspector plays clips with transcripts, lead-lag panel
renders bars, chatbot button appears if `GP_AGENT=1`.

First uploaded clip takes ~13 s (cold models), then ~8 s; cached clips are
instant.

---

## Reading the lead-lag panel honestly

**Lead-lag is computed per driver, per session — not across the whole dataset.**
446 analysed clips sounds like plenty, but it spreads to only **5–13 clips per
driver**, which is 5–11 usable lap-pairs. `MIN_PAIRS = 4` is the floor to compute
a coefficient at all.

At full coverage, measured: **11 of 36 driver/session pairs show a negative peak**
(stress first), and **none clear the significance floor**. The highest
correlations sit on the fewest pairs — the classic small-sample signature.

The code says so itself: `is_significant` stays `False` and the interpretation
string reads "Indicative only — N clips in this session." Don't paper over that;
the guard firing correctly is a better result than a green tick.

Best demo pairs, most pairs first:

| Session | Driver | Clips | Lag | r |
|---|---|---|---|---|
| 2023-dutch-r | **ALO** | 13 | −3 | 0.31 |
| 2023-dutch-r | VER | 11 | −2 | 0.18 |
| 2023-dutch-r | HUL | 10 | −4 | 0.48 |

---

## Retraining the fusion head · optional

The repo ships trained weights (`data/labels/fusion_head.json`), so this is only
for adding your own labels.

```bash
python scripts/label_clips.py     # browser UI at :5050 — 1=Calm 2=Stressed 3=Tired s=Skip
python scripts/auto_label.py      # or bootstrap from model output (less accurate)
python scripts/fit_fusion.py      # needs 80+ labels → fusion_head.json + driver_baselines.json
```

Commit both JSONs — they're what the runtime pipeline loads.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `No matching distribution found for onnxruntime==1.20.1` | venv is Python 3.9. Rebuild with `python3.12 -m venv .venv`. |
| `No matching distribution found for torch==2.5.1` | venv is Python 3.13+. Same fix. |
| `ModuleNotFoundError: No module named 'dotenv'` | pip aborted earlier in the list — fix the real error above and reinstall. |
| `ModuleNotFoundError: No module named 'app'` | Run uvicorn from `backend/`, not `backend/scripts/`. |
| **UI loads but no stress / empty panels** | **Step 6 not run.** Check `ls data/results/ \| wc -l`. |
| Chatbot 500s | `httpx` unpinned to 0.28.x — reinstall from `requirements.txt`. |
| Chatbot button missing | No `.env`, or `GP_AGENT=0`, or backend not restarted after creating `.env`. |
| `offline_ready: false` | Re-run `warm_models.py` and `cache_sessions.py`. |
| "Could not load sessions" | Backend down or on another port — `curl localhost:8000/api/health`. |
| Port in use | `kill $(lsof -ti:8000)` / `kill $(lsof -ti:5173)`. |
| `UnicodeEncodeError: 'charmap'` | Windows — prefix with `PYTHONUTF8=1`. |

---

## What's not in the repo

`.gitignore` keeps ~3 GB of regenerable files out of git.

| Missing after clone | Size | Regenerate with |
|---|---|---|
| `backend/.venv/` | 2.0 GB | step 1 |
| `~/.cache/huggingface/` | 2.3 GB | `warm_models.py` |
| `data/cache/` | 550 MB | `cache_sessions.py` |
| `data/clips/*.mp3` | 86 MB | `fetch_radio.py` |
| `frontend/node_modules/` | 160 MB | `npm install` |
| `data/results/*.json` | ~15 MB | `batch_analyse.py` |
| `backend/.env` | <1 KB | create by hand — step 7 |

**Committed and not regenerable:** `data/clips/index.csv` (446 hand labels),
`data/labels/fusion_head.json`, `data/labels/driver_baselines.json`.

There is no database. Race data is FastF1's pickle + SQLite HTTP cache, clip
metadata is a CSV, analyses are JSON files.

---

## Layout

```
backend/
  app/pipeline/   preprocess · vad · stt · prosody · ser · text_emotion
                  · baseline · fusion · strategy · leadlag · run
  app/data/       fastf1_client · laps · store · timeline
  app/schemas.py  the API contract — mirrored in frontend/src/types.ts
  scripts/        warm_models · cache_sessions · fetch_radio · batch_analyse
                  · label_clips · auto_label · fit_fusion
data/
  cache/          FastF1 sessions      (ignored)
  clips/          radio audio          (ignored; index.csv COMMITTED)
  labels/         fusion_head.json + driver_baselines.json COMMITTED
  results/        analysis cache       (ignored)
frontend/src/     React dashboard
```
