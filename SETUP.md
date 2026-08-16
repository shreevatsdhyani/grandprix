# SETUP — running this on a fresh machine

The repo contains **code, pre-trained weights, and labels only**. Models, race data and radio clips are
all downloaded by scripts, because together they are ~3 GB and none of it belongs
in version control — see `.gitignore`, and
[What is not in the repo](#what-is-not-in-the-repo) for the command that
regenerates each piece.

Total: about **20 minutes** and **~3 GB** of disk, most of it unattended download.

---

## ⚡ Quick Start - GitHub Clone to Running App

**Copy-paste this entire sequence** to go from fresh GitHub clone to running application:

```bash
# 1. Clone repository
git clone https://github.com/yourusername/grandprix.git
cd grandprix

# 2. Backend setup
cd backend
python3.12 -m venv .venv        # or: python -m venv .venv  (if Python 3.11/3.12)
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# 3. Download models & data (runs in background, ~15 min total)
python scripts/warm_models.py       # Downloads 4 HF models (~10 min)
python scripts/cache_sessions.py   # Downloads race data (~5 min)
python scripts/fetch_radio.py      # Downloads 446 MP3s (~5 min)

# 4. (OPTIONAL) Enable chatbot - Get free key: https://console.groq.com/keys
cp .env.example .env                # Windows: copy .env.example .env
# Edit .env and add your GROQ_API_KEY

# 5. Start backend (keep this terminal open)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 6. Frontend setup (NEW TERMINAL)
cd ../frontend
npm install
npm run dev

# 7. Open browser → http://localhost:5173
```

**That's it!** You now have the exact same setup as the original dev environment.

**What you already have** (committed in repo):
- ✅ All source code
- ✅ Pre-trained model weights (`data/labels/fusion_head.json`)
- ✅ Driver baselines (`data/labels/driver_baselines.json`)
- ✅ Labeled data (`data/clips/index.csv` - 446 clips with Calm/Stressed/Tired labels)
- ✅ Dependencies lists (`requirements.txt`, `package.json`)

**What the scripts download** (gitignored, ~3 GB):
- 📥 4 HuggingFace models (~2.3 GB) → `~/.cache/huggingface/`
- 📥 F1 race telemetry (~550 MB) → `data/cache/`
- 📥 446 team radio MP3s (~86 MB) → `data/clips/*.mp3`

---

## 📋 Complete Workflow Overview

This is the **complete end-to-end workflow** from fresh clone to running application:

### Quick Start (Minimum to run the app)
1. **Install dependencies** → Steps 1, 5
2. **Download models** → Step 2 (`warm_models.py`)
3. **Download race data** → Step 3 (`cache_sessions.py`)
4. **Download radio clips** → Step 4 (`fetch_radio.py`)
5. **Run app** → Step 8 (backend + frontend)

### Full Workflow (Including model training)
1. **Setup** → Steps 1-5 (dependencies + data)
2. **Pre-analyze clips** → Step 6 (`batch_analyse.py`) - Optional but recommended
3. **Label data** → Step 7 (`label_clips.py` or `auto_label.py`) - Only if training models
4. **Train fusion model** → Step 7 (`fit_fusion.py`) - Only if you labeled new data
5. **Enable chatbot** → Step 9 (`.env` with Groq API key) - Optional
6. **Run app** → Step 8 (backend + frontend)
7. **Verify** → Step 10

### 🗄️ Database Structure

**This project does NOT use a traditional database (PostgreSQL/MySQL).** Instead:

| Data Type | Storage | Purpose |
|-----------|---------|---------|
| **Race telemetry** | `data/cache/*.pickle` + SQLite | FastF1 HTTP cache (auto-managed) |
| **Radio clips** | `data/clips/*.mp3` | Audio files |
| **Clip metadata** | `data/clips/index.csv` | Clip-to-driver-lap mapping + labels |
| **Analysis results** | `data/results/*.json` | Cached AI analysis per clip |
| **Model weights** | `data/labels/fusion_head.json` | Trained fusion model |
| **Driver baselines** | `data/labels/driver_baselines.json` | Per-driver normalization stats |
| **HF models** | `~/.cache/huggingface/` | Whisper, wav2vec2, RoBERTa, Silero VAD |

**The SQLite file (`data/cache/fastf1_http_cache.sqlite`)** is FastF1's internal HTTP cache — it's **not project state**, just downloaded race data. You can delete it and re-run `cache_sessions.py` to regenerate.

### 🔄 Key Scripts and What They Do

| Script | Purpose | When to Run | Output |
|--------|---------|-------------|--------|
| `warm_models.py` | Download all 4 HF models to cache | **Once** (step 2) | `~/.cache/huggingface/` |
| `cache_sessions.py` | Download F1 race telemetry | **Once** (step 3) | `data/cache/*.pickle` |
| `fetch_radio.py` | Download team radio MP3s | **Once** (step 4) | `data/clips/*.mp3` + `index.csv` |
| `batch_analyse.py` | Pre-analyze all clips with AI pipeline | Optional (step 6) | `data/results/*.json` |
| `label_clips.py` | **Interactive labeling UI** (manual) | Only if training | Updates `index.csv` labels |
| `auto_label.py` | Auto-label using model outputs | Only if training | Updates `index.csv` labels |
| `fit_fusion.py` | **Train fusion model** on labels | After labeling 80+ clips | `fusion_head.json` + `driver_baselines.json` |

### 🚀 What Happens When You Start the App

**Backend startup (`uvicorn app.main:app`):**
1. Loads FastAPI routes
2. Loads all 4 HF models into memory (~2.3 GB RAM)
3. Loads fusion weights from `data/labels/fusion_head.json`
4. Loads driver baselines from `data/labels/driver_baselines.json`
5. Checks if Groq API key exists (for chatbot)
6. Starts WebSocket server for live progress updates
7. Exposes REST API on http://localhost:8000

**Frontend startup (`npm run dev`):**
1. Starts Vite dev server on http://localhost:5173
2. Proxies `/api/*` requests to backend (port 8000)
3. Loads React dashboard
4. Fetches available sessions from backend
5. Renders glassmorphism UI

**When you upload a clip:**
1. Frontend sends audio to `/api/analyse/upload`
2. Backend runs AI pipeline:
   - **Silero VAD** → Detects voice activity
   - **Whisper** → Transcribes speech
   - **Librosa** → Extracts prosody features (pitch, energy, rate)
   - **wav2vec2 SER** → Acoustic emotion recognition
   - **RoBERTa** → Text emotion from transcript
   - **Fusion head** → Combines all features → Final mood (Calm/Stressed/Tired)
3. Result saved to `data/results/{clip_id}.json`
4. Returns JSON to frontend
5. Dashboard updates in real-time via WebSocket

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

## 6. Pre-populate analysis cache (Optional but Recommended)

Before running the app, you can pre-analyze all clips to populate the results cache. This makes the dashboard load faster and enables the lead-lag correlation panel.

```bash
cd backend
# Activate venv if not already active
# Windows: .venv\Scripts\activate
# Mac/Linux: source .venv/bin/activate

# Analyze all clips from one session (~13s per clip)
python scripts/batch_analyse.py --session 2024-british-r

# OR analyze ALL sessions (takes ~1.5 hours for 446 clips)
python scripts/batch_analyse.py
```

This writes analysis results to `data/results/*.json`. The app works without this step (it analyzes clips on-demand), but pre-populating makes the first load much faster.

**What this does:**
- Runs the full AI pipeline on each clip (VAD → Whisper → SER → Text Emotion → Fusion)
- Saves results to `data/results/{clip_id}.json`
- Enables the Lead-Lag correlation panel (needs ≥100 analyzed clips)
- Makes the Strategy Calls panel populate with recommendations

---

## 7. Label clips and train fusion model (Optional - for model training)

The repo includes pre-trained fusion weights (`data/labels/fusion_head.json`), but if you want to **retrain the model** or **add your own labels**:

### Option A: Manual labeling (Interactive UI)

```bash
cd backend
python scripts/label_clips.py
```

This opens a **browser-based labeling tool** at http://localhost:5050:
- Listen to clips one by one
- Label as **Calm** / **Stressed** / **Tired** (or Skip)
- Keyboard shortcuts: `1` = Calm, `2` = Stressed, `3` = Tired, `s` = Skip, `Space` = Play/Pause
- Labels saved immediately to `data/clips/index.csv`

**Options:**
```bash
# Label specific session only
python scripts/label_clips.py --session 2024-british-r

# Label specific driver only
python scripts/label_clips.py --driver HAM

# Re-label already-labelled clips
python scripts/label_clips.py --relabel
```

### Option B: Auto-labeling (Using HF models)

If you've already run `batch_analyse.py`, you can auto-label clips using the model outputs:

```bash
python scripts/auto_label.py
```

This reads the `fusion.mood` field from `data/results/*.json` and writes it to `index.csv`. **Not as accurate as human labels**, but useful for bootstrapping.

**Options:**
```bash
# Dry run (see what would be labeled)
python scripts/auto_label.py --dry-run

# Only label high-confidence clips
python scripts/auto_label.py --min-conf 0.7

# Overwrite existing labels
python scripts/auto_label.py --overwrite
```

### Step C: Train the fusion model

After labeling **80-100 clips**, train the fusion head:

```bash
python scripts/fit_fusion.py
```

**What this does:**
- Reads labels from `data/clips/index.csv`
- Extracts features from all labeled clips
- Fits per-driver baselines (z-score normalization)
- Trains logistic regression fusion head
- Saves weights to `data/labels/fusion_head.json` and `data/labels/driver_baselines.json`
- Prints cross-validated accuracy

**Output example:**
```
✓ Loaded 199 labeled clips
✓ Fitted 20 driver baselines
✓ Trained fusion head (82.1% accuracy, leave-one-out CV)
✓ Saved → data/labels/fusion_head.json
✓ Saved → data/labels/driver_baselines.json
```

Commit these two JSON files — they're what the production pipeline uses.

---

## 8. Run the application

Two terminals.

**Backend:**
```bash
cd grandprix/backend

# Activate venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Start FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**
```bash
cd grandprix/frontend
npm run dev
```

**Open:** http://localhost:5173  
**API Docs:** http://localhost:8000/docs

---

## 9. Enable AI Chatbot (Optional)

The dashboard includes an AI chatbot powered by Groq LLM. To enable it:

1. **Get a free Groq API key:** https://console.groq.com/keys
2. **Create `.env` file** in `backend/`:

```bash
cd backend
# Windows PowerShell:
echo "GROQ_API_KEY=your-key-here" > .env
echo "GP_AGENT=1" >> .env

# Mac/Linux/Git Bash:
echo "GROQ_API_KEY=your-key-here" > .env
echo "GP_AGENT=1" >> .env
```

3. **Restart the backend** (it will load the agent on startup)

**What the chatbot can do:**
- Answer questions about race data ("What was Hamilton's stress in lap 15?")
- Explain correlations ("Why does stress lead pace by 4 laps?")
- Find stressed moments ("Show me when Verstappen was most stressed")
- Admits when data is unavailable (zero hallucination)

**Without `.env` or `GP_AGENT=1`:** The chatbot button won't appear in the UI.

---

## 10. Verify

**Check backend health:**
```bash
curl http://localhost:8000/api/health
```

You want:
```json
{
  "status": "ok",
  "offline_ready": true,
  "models_loaded": {
    "openai/whisper-small": true,
    "superb/wav2vec2-base-superb-er": true,
    "j-hartmann/emotion-english-distilroberta-base": true,
    "istupakov/silero-vad-onnx": true
  }
}
```

**`offline_ready: true` is the one that matters** — it means weights and race
data are both on local disk, so the app will run at the venue with no wifi.

**Check frontend:**
- Open http://localhost:5173
- You should see a **dark glassmorphism dashboard**
- Race and driver pickers should load with real data
- Timeline should show a pace chart
- Upload any clip from `data/clips/` to test the full pipeline (~13s first time)
- If `GP_AGENT=1` is set, you'll see a **floating chatbot button** (purple gradient)

**Test the AI pipeline:**
```bash
# Upload a clip via API (adjust path as needed)
curl -X POST http://localhost:8000/api/analyse/upload \
  -F "file=@data/clips/2024-british-r-HAM-160054.mp3"

# Should return JSON with stress analysis
```

**Expected behavior:**
- First analysis takes ~13s (models load on first call)
- Subsequent analyses are faster (~8-10s)
- Results cached in `data/results/`
- Dashboard updates in real-time via WebSocket

---

## 📦 What IS in the Repo (Committed to Git)

When you clone from GitHub, you **already have** these files:

| File | Size | Purpose |
|------|------|---------|
| **`data/clips/index.csv`** | 50 KB | **446 clips with labels** (Calm/Stressed/Tired) - Hand annotation! |
| **`data/labels/fusion_head.json`** | 3 KB | **Pre-trained fusion model weights** (82.1% accuracy) |
| **`data/labels/driver_baselines.json`** | 5 KB | **Per-driver baseline stats** (20 drivers) |
| All `.py`, `.ts`, `.tsx` files | ~50 MB | **Complete source code** (backend + frontend) |
| `requirements.txt`, `package.json` | 10 KB | **Dependency lists** |
| `.env.example` | 1 KB | **Environment variable template** |
| `SETUP.md`, `README.md`, `SOLUTION.md` | 200 KB | **Documentation** |

**These files make the project immediately usable** — you can run the app with pre-trained weights without training anything yourself!

---

## 📥 What is NOT in the Repo (Need to Download)

`.gitignore` keeps ~3 GB of downloadable and rebuildable files out of git. If you
have just cloned, these will be **missing** (that's expected):

| Missing after clone | Size | Regenerate with | Step |
|---|---|---|---|
| `backend/.venv/` | 2.0 GB | `pip install -r requirements.txt --extra-index-url …` | 1 |
| `~/.cache/huggingface/` | 2.3 GB | `python scripts/warm_models.py` | 2 |
| `data/cache/*.pickle` | 553 MB | `python scripts/cache_sessions.py` | 3 |
| `data/clips/*.mp3` | 86 MB | `python scripts/fetch_radio.py` | 4 |
| `frontend/node_modules/` | 161 MB | `npm install` | 5 |
| `frontend/dist/` | 5 MB | `npm run build` (for production) | Optional |
| `backend/.env` | < 1 KB | `cp .env.example .env` + add your API key | 9 |
| `data/results/*.json` | 0-15 MB | `python scripts/batch_analyse.py` (optional) | 6 |
| `data/labels/features.json` | varies | `python scripts/fit_fusion.py` (training only) | 7 |

**Why these are gitignored:**
- ✅ **Reproducible** — Every file can be regenerated from scripts
- ✅ **Downloadable** — Models/data come from public sources (HuggingFace, F1 API)
- ✅ **Large** — ~3 GB total (GitHub limit is 100 MB per file, 1 GB per repo)
- ✅ **Environment-specific** — `.env` contains secrets, `.venv` is platform-specific

**Important notes:**
- **`data/clips/index.csv` IS committed** (labels are hand annotation - cannot regenerate!)
- **Pre-trained weights ARE committed** (so you can use the app immediately)
- **The `.sqlite` in `data/cache/`** is FastF1's HTTP cache, not project state
- **`fetch_radio.py` appends** to `index.csv` and skips existing clips (won't clobber labels)

---

## 🚨 Troubleshooting

### GitHub Clone Issues

**`data/` folder is nearly empty after clone`** — **This is expected!** Only `index.csv` and `labels/*.json` are committed. Run steps 2-4 to download models, race data, and clips (~3 GB total).

**`File not found: fusion_head.json`** — Make sure you cloned from the **correct repo** with all committed files. Check:
```bash
ls data/labels/fusion_head.json              # Should exist
ls data/labels/driver_baselines.json        # Should exist
ls data/clips/index.csv                       # Should exist
```
If missing, the repo wasn't pushed correctly. Re-clone or check `.gitignore`.

**`.env file missing`** — **This is expected!** `.env` is gitignored (contains secrets). Copy from template:
```bash
cp .env.example .env              # Mac/Linux
copy .env.example .env            # Windows
```
Then edit `.env` and add your Groq API key (or leave it to run without chatbot).

---

### Installation Issues

**`ffmpeg not found`** — Step 0. Every audio library depends on it. On Windows,
`winget` only updates PATH for **new** shells: **close and reopen your terminal** after installing ffmpeg.

**`ERROR: No matching distribution found for torch==2.5.1`** — Your Python is
3.13+, which has no wheels for these dependencies. **Solution:**
```bash
# Install Python 3.12
# Windows:
winget install --id Python.Python.3.12 -e
py -3.12 -m venv .venv

# Mac:
brew install python@3.12
python3.12 -m venv .venv

# Linux:
sudo apt install python3.12 python3.12-venv
python3.12 -m venv .venv
```

**`UnicodeEncodeError: 'charmap' codec can't encode character '→'`** —
Windows only. Scripts print Unicode progress symbols. Force UTF-8:
```bash
# PowerShell:
$env:PYTHONUTF8=1; python scripts/warm_models.py

# Git Bash:
PYTHONUTF8=1 python scripts/warm_models.py
```

**`huggingface_hub symlink warning on Windows`** — **Harmless.** The cache copies files instead of symlinking. To silence:
```bash
$env:HF_HUB_DISABLE_SYMLINKS_WARNING=1
```
Or enable Developer Mode in Windows settings.

**`Permission denied` errors on Mac/Linux** — Scripts aren't executable. Fix:
```bash
chmod +x backend/scripts/*.py
```

---

### Runtime Issues

**`Port 5173 already in use`** — Another process is using Vite's port. Kill it:
```bash
# Mac/Linux:
kill $(lsof -ti:5173)

# Windows:
netstat -ano | findstr :5173
# Note the PID, then:
taskkill /PID <pid> /F
```

**`Port 8000 already in use`** — Backend port conflict. Either:
- Kill the other process, OR
- Use a different port: `uvicorn app.main:app --port 9000`
- Update `frontend/vite.config.ts` proxy target to match

**`No sessions cached`** — Step 3 (`cache_sessions.py`) didn't finish. Re-run it (it's incremental, won't re-download existing sessions).

**`offline_ready: false`** — Missing models or race data. Verify:
```bash
# Check HF models (should have 4 directories)
ls ~/.cache/huggingface/hub/               # Mac/Linux
dir %USERPROFILE%\.cache\huggingface\hub\  # Windows

# Check race data (should have 5 .pickle files)
ls data/cache/*.pickle                     # Mac/Linux
dir data\cache\*.pickle                    # Windows
```
If missing, re-run:
```bash
python scripts/warm_models.py        # Downloads models
python scripts/cache_sessions.py     # Downloads race data
```

**Frontend loads but "Could not load sessions"** — Backend isn't running or wrong port. Check:
```bash
curl http://localhost:8000/api/health
```
If fails, make sure backend is running on port 8000.

**Chatbot button doesn't appear** — Either:
1. `.env` not set up → Copy `.env.example` to `.env` and add `GROQ_API_KEY`
2. `GP_AGENT=0` in `.env` → Change to `GP_AGENT=1`
3. Backend not restarted after `.env` change → Restart uvicorn

**Clip upload fails with 500 error** — Check backend logs. Common causes:
- Models not downloaded (`warm_models.py`)
- ffmpeg not installed
- Corrupt audio file
- Out of memory (models need ~3 GB RAM)

---

### Performance Issues

**First clip takes 30+ seconds** — Models loading from disk (cold start). Subsequent clips should be ~8-10s. If ALL clips are slow:
- Check CPU usage (models are CPU-only, use all cores)
- Close other heavy apps
- Check disk I/O (HDD vs SSD makes a difference)

**Dashboard is slow/laggy** — Check browser DevTools console for errors. Common issues:
- Large `data/results/` folder (thousands of files) → Delete old cache
- Memory leak → Refresh browser
- Old browser version → Update to latest Chrome/Firefox/Edge

**`npm run dev` takes forever** — Cold start for Vite. Subsequent hot-reloads are instant. If ALWAYS slow:
- Delete `node_modules/` and run `npm install` again
- Check antivirus isn't scanning `node_modules/` on every change
- Use `npm run dev -- --open` to auto-open browser when ready

---

### Data Issues

**"No labeled clips found"** — `data/clips/index.csv` missing or corrupt. This file should be committed in git. If missing:
1. Check you cloned the right repo
2. Re-clone if `.gitignore` blocked it incorrectly
3. Run `python scripts/fetch_radio.py` to regenerate structure (loses labels!)

**Clips play but transcription is gibberish** — Whisper model issue. Re-download:
```bash
rm -rf ~/.cache/huggingface/hub/models--openai--whisper-small
python scripts/warm_models.py
```

**"Fusion model failed to load"** — Pre-trained weights missing or corrupt. Verify:
```bash
cat data/labels/fusion_head.json        # Should be valid JSON
cat data/labels/driver_baselines.json   # Should be valid JSON
```
If corrupt, re-clone the repo (these files should be committed).

---

### Cloud IDE / Dev Container Issues

**Vite HMR (hot reload) not working** — Port forwarding issue. Vite is configured with `host: true` already. Behind HTTPS proxy:
```bash
GP_PUBLIC_HTTPS=1 npm run dev
```

**Backend WebSocket fails** — Proxy doesn't support WebSockets. Check your cloud IDE docs for WebSocket port forwarding.

**Out of disk space** — ~3 GB needed. Cloud IDEs often have limited storage. Delete:
```bash
rm -rf data/results/*.json     # Analysis cache (can regenerate)
rm -rf data/cache/*            # Race data (can re-download)
```

---

### Still Stuck?

1. **Check the logs:**
   - Backend: Look at terminal where `uvicorn` is running
   - Frontend: Browser DevTools → Console tab
   - File issues: Check file permissions, paths, existence

2. **Start fresh:**
   ```bash
   # Delete everything except source code
   rm -rf backend/.venv data/cache data/clips/*.mp3 data/results
   rm -rf frontend/node_modules frontend/dist
   
   # Re-run setup from step 1
   ```

3. **Verify prerequisites:**
   ```bash
   python --version      # 3.11 or 3.12 (NOT 3.13+)
   node --version        # 20+
   ffmpeg -version       # Any version
   ```

4. **Check the validation checklist** above — compare your output to expected values

5. **Open an issue** on GitHub with:
   - Your OS (Windows 11, macOS 14, Ubuntu 22.04, etc.)
   - Python version (`python --version`)
   - Error message (full traceback)
   - What step failed
   - Output of `curl http://localhost:8000/api/health`

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

## 📚 Common Tasks Reference

### Re-analyzing clips (force refresh)
```bash
# Re-analyze specific session
python scripts/batch_analyse.py --session 2024-british-r --force

# Re-analyze ALL clips (overwrites cache)
python scripts/batch_analyse.py --force
```

### Checking what's cached
```bash
# Count analyzed clips
ls data/results/*.json | wc -l        # Mac/Linux
dir data\results\*.json | measure     # Windows PowerShell

# Check labeled clips
python -c "import pandas as pd; df = pd.read_csv('data/clips/index.csv'); print(f'{df.label.notna().sum()} / {len(df)} labeled')"
```

### Starting fresh
```bash
# Delete all cached analyses (keeps labels)
rm -rf data/results/*.json            # Mac/Linux
del data\results\*.json                # Windows

# Delete model cache (re-download with warm_models.py)
rm -rf ~/.cache/huggingface           # Mac/Linux
rmdir /s %USERPROFILE%\.cache\huggingface  # Windows

# Delete race data (re-download with cache_sessions.py)
rm -rf data/cache/*                   # Mac/Linux
del data\cache\*                      # Windows
```

### Production deployment checklist
- [ ] Run `batch_analyse.py` to pre-populate `data/results/`
- [ ] Ensure `fusion_head.json` and `driver_baselines.json` exist
- [ ] Set `GP_AGENT=1` and `GROQ_API_KEY` in `.env` for chatbot
- [ ] Verify `offline_ready: true` in `/api/health`
- [ ] Build frontend: `npm run build` (creates `frontend/dist/`)
- [ ] Use production server: `uvicorn app.main:app --host 0.0.0.0 --port 8000` (no `--reload`)

### File size reference
```
Total project size (after full setup): ~3.2 GB
├── backend/.venv/          2.0 GB  (Python packages)
├── ~/.cache/huggingface/   2.3 GB  (HF models)
├── data/cache/             550 MB  (Race telemetry)
├── data/clips/              86 MB  (446 MP3 files)
├── data/results/           ~15 MB  (446 JSON results)
├── frontend/node_modules/  160 MB  (npm packages)
└── Code                    ~50 MB  (source files)
```

---

## 🔧 Advanced Configuration

### Running on a different port
```bash
# Backend on port 9000
uvicorn app.main:app --host 0.0.0.0 --port 9000

# Update frontend proxy (vite.config.ts)
# Change: target: 'http://localhost:8000' → 'http://localhost:9000'
```

### Using a custom model cache directory
```bash
# Set HuggingFace cache location
export HF_HOME=/path/to/custom/cache  # Mac/Linux
set HF_HOME=C:\path\to\custom\cache   # Windows

# Then run warm_models.py
python scripts/warm_models.py
```

### Disabling the chatbot
```bash
# Remove from .env or set to 0
GP_AGENT=0

# Or delete .env file entirely
rm backend/.env
```

### Building for production
```bash
# Frontend
cd frontend
npm run build       # Creates frontend/dist/
npm run preview     # Test production build

# Backend (use gunicorn for production)
pip install gunicorn
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## ❓ FAQ

**Q: Do I need to label clips to use the app?**  
A: No. The repo includes pre-trained weights (`fusion_head.json`). You only need to label if you want to **retrain** the model.

**Q: Do I need to run `batch_analyse.py`?**  
A: No, but recommended. Without it, clips are analyzed on-demand (~13s each), which makes the first dashboard load slow. Pre-analyzing makes the UI snappier.

**Q: What if I don't have a Groq API key?**  
A: The app works fine without it. You just won't see the chatbot button. All other features (stress analysis, timeline, radio inspector) work normally.

**Q: Can I use a different LLM provider?**  
A: Yes, but you'll need to modify `backend/app/agent_config.py` and `backend/app/routers/agent.py`. The current code uses Groq's function calling API.

**Q: How do I add more sessions?**  
A: Edit `backend/app/data/fastf1_client.py` → add session to `SESSIONS` list → run `cache_sessions.py` → run `fetch_radio.py`.

**Q: Where is the database?**  
A: There isn't one! All data is in CSV/JSON files and SQLite cache (FastF1's HTTP cache). See [Database Structure](#-database-structure) above.

**Q: Can I run this offline?**  
A: Yes, after initial setup. Once `offline_ready: true`, you don't need internet. The chatbot needs internet (calls Groq API), but the core AI pipeline is fully local.

**Q: How do I update model weights?**  
A: Label more clips → run `fit_fusion.py` → commit the new `fusion_head.json` and `driver_baselines.json`.

---

## 🎓 Understanding the Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. DATA ACQUISITION (Steps 2-4)                                 │
├─────────────────────────────────────────────────────────────────┤
│ warm_models.py      → Downloads HF models to ~/.cache/          │
│ cache_sessions.py   → Downloads race data to data/cache/        │
│ fetch_radio.py      → Downloads clips to data/clips/            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. MODEL TRAINING (Step 7 - OPTIONAL)                           │
├─────────────────────────────────────────────────────────────────┤
│ label_clips.py      → Manual labeling → index.csv               │
│ auto_label.py       → Auto labeling → index.csv                 │
│ fit_fusion.py       → Train model → fusion_head.json            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. PRE-ANALYSIS (Step 6 - OPTIONAL)                             │
├─────────────────────────────────────────────────────────────────┤
│ batch_analyse.py    → Analyze all clips → data/results/*.json   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. RUNTIME (Step 8)                                              │
├─────────────────────────────────────────────────────────────────┤
│ Backend (uvicorn)   → Loads models + weights                    │
│ Frontend (Vite)     → Serves React dashboard                    │
│ User uploads clip   → Pipeline runs → Result cached + shown     │
└─────────────────────────────────────────────────────────────────┘
```

### File Dependencies

```
index.csv ─────────┐
(labels)           │
                   ├──> fit_fusion.py ──> fusion_head.json ──┐
results/*.json ────┘                                         │
(features)                                                   │
                                                             │
fusion_head.json ──────────────────┐                        │
driver_baselines.json ─────────────┤                        │
clips/*.mp3 ───────────────────────┼──> RUNTIME PIPELINE    │
HF models (~/.cache/) ─────────────┤    (uvicorn)           │
cache/*.pickle (race data) ────────┘                        │
                                                             │
                                    ┌────────────────────────┘
                                    │
                                    ├──> results/*.json (cached)
                                    │
                                    └──> Frontend (real-time UI)
```

---

## ✅ Final Validation Checklist

Use this checklist to verify your setup **exactly matches the original dev environment**:

### After Initial Setup (Steps 1-5)

```bash
# Check Python version
python --version
# Want: Python 3.11.x or 3.12.x (NOT 3.13+)

# Check Node version
node --version
# Want: v20.x or higher

# Check ffmpeg
ffmpeg -version
# Want: Any version (just needs to exist)

# Check backend venv is activated
which python          # Mac/Linux (should show .venv path)
where python          # Windows (should show .venv path)

# Check PyTorch is CPU build
python -c "import torch; print(torch.__version__)"
# Want: 2.5.1+cpu (the +cpu suffix is critical)

# Check HF models downloaded (should show 4 models)
python -c "from transformers import pipeline; print('✓ Models cached')"

# Check race data cached (should list 5 sessions)
ls data/cache/*.pickle | wc -l        # Mac/Linux (want: 5)
dir data\cache\*.pickle               # Windows (want: 5 files)

# Check clips downloaded (should be 446)
ls data/clips/*.mp3 | wc -l           # Mac/Linux (want: 446)
dir data\clips\*.mp3 | measure        # Windows (want: 446)

# Check committed files exist
ls data/clips/index.csv                      # ✓ Should exist
ls data/labels/fusion_head.json             # ✓ Should exist
ls data/labels/driver_baselines.json        # ✓ Should exist

# Check frontend dependencies
cd frontend && npm list --depth=0
# Should show react@19, vite@6, recharts, etc.
```

### After Starting the App (Step 8)

```bash
# Backend health check
curl http://localhost:8000/api/health

# Expected response:
# {
#   "status": "ok",
#   "offline_ready": true,   ← CRITICAL: Must be true
#   "models_loaded": {
#     "openai/whisper-small": true,
#     "superb/wav2vec2-base-superb-er": true,
#     "j-hartmann/emotion-english-distilroberta-base": true,
#     "istupakov/silero-vad-onnx": true
#   }
# }
```

**If `offline_ready: false`:**
- Re-run `python scripts/warm_models.py`
- Re-run `python scripts/cache_sessions.py`
- Check `~/.cache/huggingface/` has 4 model directories
- Check `data/cache/` has 5 `.pickle` files

### Frontend Visual Validation

Open http://localhost:5173 and verify:

- [ ] **Dashboard loads** (dark glassmorphism theme)
- [ ] **Session picker** shows 5 sessions (2023-dutch-r, 2024-british-r, etc.)
- [ ] **Driver picker** shows all drivers for selected session
- [ ] **Timeline chart** renders with real pace data
- [ ] **Upload clip** → Analysis runs (~13s) → Result shows mood + confidence
- [ ] **Radio inspector** shows clip details, transcript, audio player
- [ ] **(If GP_AGENT=1)** Floating chatbot button appears (purple gradient)
- [ ] **No console errors** in browser DevTools

### Chatbot Validation (If Enabled)

- [ ] `.env` file exists with `GP_AGENT=1` and valid `GROQ_API_KEY`
- [ ] Backend logs show "Agent layer loaded" on startup
- [ ] Chatbot button visible in UI
- [ ] Clicking button opens chat panel
- [ ] Sending message gets response (not error)
- [ ] Agent answers with real data (not hallucinations)

### Performance Benchmarks

```bash
# First clip analysis (cold start)
# Expected: 10-15 seconds

# Subsequent clips (models warmed)
# Expected: 8-10 seconds

# Cached clip re-analysis
# Expected: < 1 second (reads from data/results/)

# Agent response (fresh query)
# Expected: 2-5 seconds

# Agent response (cached)
# Expected: < 100ms
```

---

## 🎉 Success Criteria

**Your setup is IDENTICAL to the original if:**

✅ `offline_ready: true` in `/api/health`  
✅ All 4 models loaded (`models_loaded` all `true`)  
✅ 446 clips in `data/clips/` + `index.csv` with labels  
✅ 5 sessions in `data/cache/`  
✅ Pre-trained weights exist (`fusion_head.json`, `driver_baselines.json`)  
✅ Dashboard loads with real data (not errors)  
✅ Clip upload → Analysis → Result (~13s first time, ~8s subsequent)  
✅ Timeline shows pace chart, radio inspector works  
✅ (Optional) Chatbot responds with real data  

**At this point, you can:**
- ✅ Demo the app offline (no internet needed except for chatbot)
- ✅ Analyze new clips with pre-trained model
- ✅ Label clips and retrain if you want
- ✅ Deploy to production (see Advanced Configuration)

---
