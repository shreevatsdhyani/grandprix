# Understanding "The Silent Co-Driver" — In Simple Words

> This document breaks down every part of the project so anyone on the team
> (or a fresh pair of eyes) can understand what it does, why it does it that way,
> and how all the pieces fit together.

---

## 1. The One-Liner

**"We listen to how an F1 driver *sounds* on the radio, figure out if they're calm, stressed or tired, line that up against their lap times, and show that the voice gives the warning *before* the stopwatch does."**

It's a hackathon project for **AI Race Month · GrandPrix** (Problem Statement 1).

---

## 2. The Problem It Solves

In Formula 1, race engineers stare at 20+ telemetry channels (tyre temps, fuel, lap times, etc.).
**Nobody is systematically listening to *how* the driver sounds** when they talk on team radio.

By the time a driver's stress or fatigue shows up in their lap times, they've already lost track position. The idea here is:

> What if the driver's **voice** is an earlier warning than the **stopwatch**?

So this project:
1. Takes a team-radio audio clip
2. Transcribes what the driver said
3. Analyzes *how* they said it (pitch, energy, speed, pauses)
4. Labels it **Calm**, **Stressed**, or **Tired**
5. Lines it up against real lap-time data
6. Shows whether the voice-stress signal appears *before* the pace drops

---

## 3. Why One AI Model Isn't Enough (The Core Argument)

This is the **most important idea** in the whole project:

The hackathon brief asks for three labels: **Calm, Stressed, Tired**.

Every pre-made speech-emotion AI model (on Hugging Face) is trained on datasets like IEMOCAP or RAVDESS. Their labels are things like *angry, happy, sad, neutral, fearful*. **Not a single one has a "tired" class.**

Why? Because **tiredness isn't an emotion — it's a physical state of the voice**. A tired person speaks with:
- Lower pitch
- Flat pitch (not going up and down)
- Quieter voice
- Slower speech
- Longer pauses

A standard emotion model would call a tired driver "sad" or "neutral" — which tells the pit wall nothing useful.

**So we can't just use one model.** We need to combine multiple signals:

| Signal Branch | What It Looks At | Why It's Needed |
|---|---|---|
| **Prosody** (voice features) | Pitch, energy, speech speed, pauses, jitter | The **only** branch that can detect tiredness |
| **Acoustic SER** (speech emotion) | A pre-trained emotion model | Good at detecting agitation/anger, useless for fatigue |
| **Text emotion** | What the driver *said* (the words) | Catches things like a calm-sounding driver saying "I've got nothing left" |

This combination of three branches is called **fusion**, and it's what separates this project from a simple "plug in one model" solution.

---

## 4. How It's Built — The Architecture

The project has two main halves: **Backend** (Python) and **Frontend** (React).

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FRONTEND (what you see)                          │
│         React + Vite + TypeScript + Tailwind + Recharts             │
│                                                                     │
│   Pick a Race & Driver → See timeline chart → Click radio markers   │
│   → Hear the clip → See the stress breakdown → See strategy calls   │
│                                                                     │
│   [Single Model  ⇄  Fusion (ours)]  ← toggle to compare            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  REST API calls (HTTP)
┌─────────────────────────▼───────────────────────────────────────────┐
│                    BACKEND (the brain)                               │
│              FastAPI (Python 3.11)                                   │
│                                                                     │
│   Receives audio → Runs the AI pipeline → Returns results           │
│   Serves lap data from FastF1 → Computes strategy calls             │
│   Computes lead-lag correlation                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. The Analysis Pipeline — Step by Step

When an audio clip goes in, here's what happens:

```
Audio clip
  │
  ▼
[1] PREPROCESS — Resample to 16kHz mono, normalise loudness
  │
  ▼
[2] VAD (Voice Activity Detection) — Find the speech, strip engine noise & silence
  │
  ├──▶ [3] WHISPER STT — Transcribe speech to text (with word timestamps)
  │         │
  │         └──▶ [5] TEXT EMOTION — Read emotion from the *words*
  │                    (e.g. "I've got nothing left" → tired)
  │
  ├──▶ [4] ACOUSTIC SER — Pre-trained emotion model on the audio
  │         (returns labels like angry/sad/neutral)
  │
  └──▶ [4b] PROSODY — Hand-engineered voice features:
              • Pitch (high/low, flat/variable)
              • Energy (loud/quiet)
              • Speech rate (fast/slow)
              • Pause ratio (% of silence)
              • Jitter (voice wobble)
              ↓
              Z-scored against this driver's OWN baseline
              (so a naturally loud driver doesn't read as stressed)
                                    │
                                    ▼
                    [6] FUSION HEAD — Combines all three branches
                         → P(Calm), P(Stressed), P(Tired)
                         → Stress Index (0–100)
                                    │
                                    ▼
                    [7] ALIGN TO LAP — Match the clip to a lap number
                    [8] LEAD-LAG — Cross-correlate stress vs pace over time
                    [9] STRATEGY — Generate pit-wall decisions
```

### What each pipeline module does (the actual files):

| File | What It Does |
|---|---|
| [preprocess.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/preprocess.py) | Converts any audio to 16kHz mono WAV, normalises loudness to -20 dBFS, trims silence |
| [vad.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/vad.py) | Uses Silero VAD (tiny ONNX model) to find speech segments and strip engine noise |
| [stt.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/stt.py) | Runs OpenAI Whisper to transcribe speech, with word-level timestamps |
| [prosody.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/prosody.py) | Extracts 8 voice features using librosa (pitch, energy, speech rate, pauses, jitter, spectral centroid) |
| [baseline.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/baseline.py) | Z-scores each feature against the driver's own "calm" baseline. Falls back to population priors if no labels exist yet |
| [ser.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/ser.py) | Runs wav2vec2 speech emotion model. Maps its labels (angry/sad/etc.) onto a 0–100 stress score |
| [text_emotion.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/text_emotion.py) | Runs DistilRoBERTa on the transcript text to read emotion from words |
| [fusion.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/fusion.py) | Combines all three branches. If a trained head exists, uses logistic regression; otherwise uses a rule-based fallback |
| [strategy.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/strategy.py) | Converts stress readings into pit-wall decisions: BOX_NOW, PIT_WINDOW_OPENING, HOLD, REDUCE_RADIO_LOAD, MONITOR |
| [leadlag.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/leadlag.py) | Cross-correlates stress series against lap-delta series at different time offsets to find if voice leads pace |
| [run.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/run.py) | Orchestrates the entire pipeline end-to-end for one clip |
| [models.py](file:///c:/Users/hp/Desktop/grandprix/backend/app/pipeline/models.py) | Lazy-loads and caches all the ML models so they're only loaded once |

---

## 6. The 4 Hugging Face Models Used

| Role | Model | Size | Why |
|---|---|---|---|
| Speech-to-Text | `openai/whisper-small` | 927 MB | Transcribes driver radio + provides word timestamps for speech-rate calculation |
| Acoustic Emotion | `superb/wav2vec2-base-superb-er` | 722 MB | Detects anger/agitation from audio. Has no tired class (that's the point!) |
| Text Emotion | `j-hartmann/emotion-english-distilroberta-base` | 630 MB | Reads emotion from the transcript words |
| Voice Activity Detection | `istupakov/silero-vad-onnx` | 3.5 MB | Finds speech in noisy radio audio |

Total: ~2.3 GB of model weights, all cached locally so the demo works offline.

---

## 7. The Data

### Race Data (FastF1)
- 5 real Grand Prix sessions cached to disk (553 MB)
- 5,598 laps across all sessions
- Real lap times, tyre compounds, stint info, track status
- Races: Dutch GP, São Paulo, Singapore, Italian, British

### Lap Delta (the smart part)
Instead of plotting raw lap times (which go down as fuel burns off), we compute:
```
delta = this_lap_time − rolling_median(last 5 clean laps)
```
This shows whether the driver is **gaining or losing time relative to their own trend**. In-laps, out-laps, safety car laps, and deleted laps are excluded.

### Radio Clips
- **446 clips** auto-downloaded from F1 live-timing data
- Mapped to specific laps using session timestamps
- Stored in `data/clips/` with an `index.csv` manifest

### Labels (THE MISSING PIECE)
- **No clips are labelled yet** — this is the #1 blocker
- The team needs to manually label 80–100 clips as Calm/Stressed/Tired
- Two annotators should label independently, keep only agreements
- Target split: ~40% Calm, ~40% Stressed, ~20% Tired

---

## 8. The Frontend — What the User Sees

Built with React + Vite + TypeScript + Tailwind CSS + Recharts.

### Components:

| Component | What It Shows |
|---|---|
| **Header** | Race picker, Driver picker, Scoring mode toggle (Single Model ⇄ Fusion) |
| [RaceTimeline.tsx](file:///c:/Users/hp/Desktop/grandprix/frontend/src/components/RaceTimeline.tsx) | The hero chart — two panels sharing a lap axis: pace delta (seconds) on top, stress index (0–100) below, with clickable radio markers |
| [RadioInspector.tsx](file:///c:/Users/hp/Desktop/grandprix/frontend/src/components/RadioInspector.tsx) | When you click a marker: audio player, transcript, mood label + confidence, upload button for new clips |
| [SignalBars.tsx](file:///c:/Users/hp/Desktop/grandprix/frontend/src/components/SignalBars.tsx) | Three horizontal bars showing the contribution of each branch (prosody / acoustic / text) to the verdict |
| [StrategyCalls.tsx](file:///c:/Users/hp/Desktop/grandprix/frontend/src/components/StrategyCalls.tsx) | Pit-wall feed: "L28 ⚠ stress rising", "L33 ▸ suggest: box" — strategy decisions generated from stress data |
| [LeadLagPanel.tsx](file:///c:/Users/hp/Desktop/grandprix/frontend/src/components/LeadLagPanel.tsx) | The correlation chart — shows whether voice stress leads or follows pace loss, with the peak lag highlighted |
| **Driver Baseline** | Shows whether scoring uses per-driver calibration, cohort average, or population priors |

### The A/B Toggle
A button in the header switches between:
- **"Single Model"** — just the acoustic emotion model, like a one-model submission would give
- **"Fusion (ours)"** — all three branches combined

Flipping it **live** shows that the naive path can't detect tiredness and mislabels tired drivers. This is the visual proof that fusion works.

---

## 9. The Backend — API Endpoints

| Endpoint | Method | What It Does |
|---|---|---|
| `/api/health` | GET | Reports system status, which models are loaded, and whether it's offline-ready |
| `/api/sessions` | GET | Lists all cached race sessions with their drivers |
| `/api/timeline/{session_id}` | GET | Returns the merged timeline: pace deltas + stress readings + strategy calls + lead-lag analysis |
| `/api/analyse` | POST | Upload an audio clip → runs the full pipeline → returns the analysis result |
| `/api/clips/{clip_id}` | GET | Serves audio files back to the browser for playback |

---

## 10. The Strategy Layer

The brief's theme is "Racing Strategy & Decision-Making", so the project doesn't just label mood — it generates **pit-wall instructions**:

| Code | Meaning | When It Fires |
|---|---|---|
| `HOLD` | "Don't change strategy" | Stress is high but pace is fine — driver is just venting |
| `MONITOR` | "Keep watching" | Single elevated stress reading |
| `BOX_NOW` | "Pit this lap" | Stress elevated for 3+ consecutive calls AND pace is worsening |
| `PIT_WINDOW_OPENING` | "Start thinking about a stop" | Fatigue detected on a long stint (past median stint length) |
| `REDUCE_RADIO_LOAD` | "Stop talking to the driver" | 3+ elevated calls within 6 laps — driver is overwhelmed |

The **HOLD** call is especially important: knowing when *not* to act is most of race strategy. A system that only ever escalates would be ignored by real engineers.

---

## 11. The Lead-Lag Analysis (The Headline Insight)

This is the project's **killer feature**:

Cross-correlate stress series against pace-delta series at lags from -4 to +4 laps.

- **Negative peak lag** (e.g. -2) = stress appeared 2 laps BEFORE the pace dropped → **the voice is a predictor**
- **Zero lag** = they move together → voice is concurrent, not predictive
- **Positive lag** = stress followed pace loss → voice is reactive

If the voice leads the pace, the pitch becomes:
> "By the time the stopwatch shows a problem, you've already lost the position. The voice showed it two laps earlier."

The module is honest: with ~100 clips it flags the result as "indicative, not conclusive" and says so in the UI.

---

## 12. Per-Driver Calibration

A naturally loud Italian driver isn't stressed — he's just Italian. So:

1. Every prosody feature is **z-scored** against that driver's own calm-radio baseline
2. The question becomes "is he louder/faster/higher-pitched **than his own normal**?"
3. Falls back: driver → cohort average → population priors

This is tracked transparently: the UI shows *which* reference was used ("calibrated to HAM" vs "population priors, not individually calibrated").

---

## 13. Project File Structure

```
grandprix/
├── PLAN.md              ← Detailed hackathon build plan (the blueprint)
├── README.md            ← Project overview & architecture diagram
├── STATUS.md            ← Current progress tracker (as of Aug 11)
├── SETUP.md             ← Setup instructions
│
├── backend/
│   ├── requirements.txt ← Python dependencies
│   ├── app/
│   │   ├── main.py      ← FastAPI app entry point
│   │   ├── config.py    ← All paths, model IDs, thresholds
│   │   ├── schemas.py   ← THE API CONTRACT (single source of truth)
│   │   │
│   │   ├── pipeline/    ← The AI analysis pipeline
│   │   │   ├── run.py           ← Orchestrator
│   │   │   ├── models.py        ← Lazy model loading
│   │   │   ├── preprocess.py    ← Audio normalisation
│   │   │   ├── vad.py           ← Voice activity detection
│   │   │   ├── stt.py           ← Whisper speech-to-text
│   │   │   ├── prosody.py       ← Voice feature extraction
│   │   │   ├── baseline.py      ← Per-driver calibration
│   │   │   ├── ser.py           ← Acoustic emotion model
│   │   │   ├── text_emotion.py  ← Text emotion model
│   │   │   ├── fusion.py        ← Combine all branches → verdict
│   │   │   ├── strategy.py      ← Mood → pit-wall decisions
│   │   │   └── leadlag.py       ← Cross-correlation analysis
│   │   │
│   │   ├── routers/     ← API endpoint handlers
│   │   │   ├── health.py        ← /api/health
│   │   │   ├── session.py       ← /api/sessions, /api/timeline
│   │   │   ├── analyse.py       ← /api/analyse (upload + run pipeline)
│   │   │   └── clips.py         ← /api/clips/{id} (serve audio)
│   │   │
│   │   ├── data/        ← Race data access
│   │   │   ├── fastf1_client.py ← FastF1 wrapper
│   │   │   ├── laps.py          ← Lap delta computation
│   │   │   ├── store.py         ← Result caching
│   │   │   └── timeline.py      ← Build the merged timeline
│   │   │
│   │   └── fixtures/    ← Synthetic demo data (for frontend dev)
│   │       └── demo.py
│   │
│   └── scripts/
│       ├── cache_sessions.py  ← Download & cache FastF1 race data
│       ├── fetch_radio.py     ← Download radio clips from F1 API
│       ├── fit_fusion.py      ← Train the fusion head on labelled clips
│       ├── warm_models.py     ← Pre-download all model weights
│       └── dev.sh             ← Dev startup script
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── main.tsx           ← React entry point
│       ├── App.tsx            ← Main application component
│       ├── api.ts             ← API client functions
│       ├── types.ts           ← TypeScript types (mirror of schemas.py)
│       ├── index.css          ← Global styles + design tokens
│       └── components/
│           ├── RaceTimeline.tsx    ← Hero chart (pace + stress)
│           ├── RadioInspector.tsx  ← Audio player + transcript
│           ├── SignalBars.tsx      ← Three-branch breakdown
│           ├── StrategyCalls.tsx   ← Pit-wall decision feed
│           └── LeadLagPanel.tsx    ← Correlation analysis chart
│
└── data/
    ├── cache/   ← FastF1 session cache (553 MB)
    ├── clips/   ← Radio audio files + index.csv (446 clips)
    ├── labels/  ← Human annotations (EMPTY — needs filling!)
    └── results/ ← Cached analysis results
```

---

## 14. Key Design Decisions (and Why)

| Decision | Why |
|---|---|
| **Python backend** | HuggingFace ecosystem is Python — no alternative |
| **FastAPI** | Modern, fast, auto-generates API docs at `/docs` |
| **React + Vite** | Fastest path to a polished dark dashboard |
| **Recharts** | Dual charts with custom markers with minimal code |
| **Two separate panels instead of dual-axis chart** | A dual y-axis can manufacture false correlation through arbitrary scale alignment — which is fatal when correlation *is* the headline claim |
| **CPU-only PyTorch** | Demo runs on a laptop with no GPU. ~200 MB instead of ~2.5 GB |
| **Local model weights, not API calls** | The GrandPrix on Aug 22 is offline. If wifi fails, the demo must still work |
| **JSON file storage, no database** | A DB is pure risk here. JSON on disk is simple and reliable |
| **Both scoring paths always computed** | The A/B toggle is instant — no need to re-run the pipeline |
| **schemas.py is the single source of truth** | Frontend types.ts is a hand-maintained mirror. Change one → change both |

---

## 15. Current Status (as of Aug 12)

### ✅ What Works
- Full end-to-end pipeline (audio in → analysis out)
- 5 real race sessions cached, 446 real radio clips downloaded
- 4 HuggingFace models loaded and running
- React dashboard with all panels built
- A/B toggle functional
- Offline-ready (`offline_ready: true`)
- Strategy calls generating
- Lead-lag correlation code complete

### ❌ What's Missing (Blockers)
1. **No clips are labelled** — this means:
   - The fusion head is untrained (using rule-based fallback)
   - Per-driver baselines are population priors, not real
   - Lead-lag panel has no data to work with
   - No accuracy number to report
2. **HuggingFace accounts not created for all team members** (Rule 03a violation)
3. **Dataset not published to HuggingFace Hub**
4. **HF Space not deployed**

### ⚡ The #1 Priority
**Label 80–100 clips.** Everything else is built and waiting for this input. Once labels exist:
- Run `python scripts/fit_fusion.py` → fusion head trains, baselines compute, accuracy number appears
- All four differentiators (lead-lag, A/B toggle, per-driver calibration, strategy) light up

---

## 16. How to Run It

### Backend
```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python scripts/cache_sessions.py    # cache race data
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

### Frontend (second terminal)
```bash
cd frontend
npm install
npm run dev    # opens at http://localhost:5173
```

### Environment Variables
| Variable | Default | Purpose |
|---|---|---|
| `GP_USE_FIXTURES` | `1` | Use synthetic data; set `0` for real pipeline |
| `GP_OFFLINE` | `0` | Block all network calls (for offline demo) |
| `GP_STT_MODEL` | `openai/whisper-small` | Override speech-to-text model |
| `GP_SER_MODEL` | `superb/wav2vec2-base-superb-er` | Override emotion model |

---

## 17. The 3-Minute Demo Flow

1. **"The problem"** (20s) — Engineers watch numbers, nobody listens to the voice
2. **"The screen"** (15s) — Show the timeline loaded with a real race
3. **"The moment"** (30s) — Click a radio marker, hear the clip, see the label
4. **"The edge"** (35s) — Point at lead-lag: voice leads the stopwatch
5. **"Why not one model"** (30s) — Flip the A/B toggle live
6. **"It's real"** (25s) — Upload a fresh clip, watch pipeline stages tick
7. **"Honesty + close"** (25s) — State limitations, mention HF contributions

---

## 18. Bugs Already Found & Fixed

These are worth knowing about — they were silent and subtle:

1. **FastF1 fuzzy-matched "Interlagos" to the Dutch GP** — cached Zandvoort twice, only had 4 races while thinking there were 5
2. **Silero VAD returned 0% speech on everything** — needs 576-sample windows (512 + 64 context), not bare 512
3. **Failed pitch tracking scored as extreme fatigue** — f0=0 z-scored to -3.57, making noisiest clips appear most tired
4. **Pause ratio measured after pauses were removed** — always ~0, biasing every driver the same
5. **"São Paulo" crashed on non-ASCII in URLs** — fixed with percent-encoding
6. **Session slug deleted "ã" from São Paulo** — NFKD normalisation fix

---

## 19. Summary in One Paragraph

This is a full-stack AI project that analyzes F1 team-radio audio to detect driver stress and fatigue, using a fusion of three AI signal branches (voice features, acoustic emotion, text emotion) because no single model can detect tiredness. It lines up the stress readings against real lap-time data from FastF1 to show that voice stress appears before pace loss — making it an early-warning system for the pit wall, not just a mood classifier. The frontend is a dark telemetry-style dashboard with an A/B toggle to compare single-model vs fusion approaches live. Everything runs offline on a laptop. The main thing still needed is human-labelled clips to train the fusion head and produce real accuracy numbers.
