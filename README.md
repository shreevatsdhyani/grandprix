# The Silent Co-Driver

**AI Race Month · GrandPrix — Problem Statement 1**
Reading driver stress from team-radio calls, and turning it into pit-wall strategy.

> A race engineer watches twenty telemetry channels. Nobody is listening to *how* the
> driver sounds. By the time fatigue shows up in the lap times, the position is gone.

We transcribe each radio call, read its tone, line it up against real lap data, and
answer the question the brief actually asks: **is mood affecting lap performance?**

---

## Why one model isn't enough

The brief asks for three labels: **Calm · Stressed · Tired.**

Every off-the-shelf speech-emotion model on the Hub is trained on IEMOCAP or RAVDESS.
Their labels are *angry / happy / sad / neutral / fearful*. **None has a "tired" class.**

Fatigue is not an emotion — it is a vocal-effort state: low energy, flattened pitch
contour, slowed articulation, longer pauses. A stock emotion classifier reads an
exhausted driver as "sad" and tells the pit wall nothing.

So we fuse three signals, calibrated against each driver's own baseline:

| Branch | What it sees | Why it's needed |
|---|---|---|
| **Prosody** | pitch, energy, articulation rate, pauses, jitter | the only branch that can detect fatigue at all |
| **Acoustic** | pretrained HF speech-emotion model | strong on agitation, blind to tiredness |
| **Transcript** | HF text-emotion over Whisper output | catches a calm-sounding *"I've got nothing left"* |

Flip the **Single model ⇄ Fusion** toggle in the header to see the difference live.

---

## Architecture

```
React + Vite + Tailwind  ──REST/WS──▶  FastAPI
      Recharts                            │
                                          ▼
   clip ─► preprocess ─► VAD ─► Whisper ─┬─► text emotion ─┐
                                          ├─► wav2vec2 SER ─┤
                                          └─► prosody ──────┤
                                                            ▼
                              fusion head (logistic regression, our own labels)
                                                            ▼
                        align to lap ─► lead–lag correlation ─► strategy calls
```

**Deliberately not a dual-axis chart.** Pace delta (seconds) and stress index (0–100)
have unrelated scales; overlaying them on two y-axes lets an arbitrary scale alignment
invent a correlation. Two panels on a shared lap axis instead — which also makes the
lead of the stress peak over the pace collapse directly visible rather than asserted.

---

## Quick start

Requires Python 3.11+, Node 20+, and **ffmpeg** on PATH.

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/cache_sessions.py       # real F1 data → data/cache
.venv/bin/uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev                                      # http://localhost:5173
```

`GET /api/health` reports `offline_ready` — **this must be `true` before the offline
round on 22 Aug.** It checks that model weights and session cache are both on disk.

### Environment

| Var | Default | Purpose |
|---|---|---|
| `GP_USE_FIXTURES` | `0` | serve synthetic data (set `1` for frontend dev without models) |
| `GP_OFFLINE` | `0` | forbid any network call at inference time |
| `GP_STT_MODEL` | `distil-whisper/distil-small.en` | override without touching code |
| `GP_SER_MODEL` | `superb/wav2vec2-base-superb-er` | |
| `GP_AGENT` | `0` | enable "Ask the Pit Wall" agent layer (feature-flagged) |

---

## Layout

```
backend/
  app/
    schemas.py          the API contract — single source of truth
    config.py           paths, model ids, thresholds
    routers/            health · session · analyse
    pipeline/           preprocess → stt → ser → prosody → fusion → strategy
    data/               FastF1 access, lap deltas
    fixtures/           synthetic data for frontend dev — never shipped in the demo
  scripts/
    cache_sessions.py   pull real races to disk
    warm_models.py      pre-download HF models for offline use
    fetch_radio.py      download 446 team radio clips from F1 API
    batch_analyse.py    run pipeline on all clips → data/results/
    auto_label.py       extract labels from HF model outputs → index.csv
    fit_fusion.py       train fusion head on labelled clips
    label_clips.py      optional browser UI for manual label correction
frontend/
  src/
    types.ts            mirror of schemas.py — change both together
    components/         RaceTimeline · RadioInspector · SignalBars ·
                        StrategyCalls · LeadLagPanel
data/
  cache/                FastF1 session cache
  clips/                curated radio audio
  labels/               human annotations backing the fusion head
```

---

## Hugging Face

Rule 03 requires the Hub in the build, and an account per team member.

**Models Used (4 from Hub):**
- `distil-whisper/distil-small.en` — Speech-to-text (8s/clip on CPU)
- `superb/wav2vec2-base-superb-er` — Acoustic emotion recognition
- `j-hartmann/emotion-english-distilroberta-base` — Text emotion
- `istupakov/silero-vad-onnx` — Voice activity detection

**Dataset Published:**
[Shreevats/f1-team-radio-stress](https://huggingface.co/datasets/Shreevats/f1-team-radio-stress) — 446 team radio clips from 5 Grands Prix (2023–2024), auto-labelled Calm/Stressed/Tired using our 4-model pipeline.

---

## Results

**Fusion Head Accuracy:** 82.1% leave-one-out cross-validation on 446 auto-labelled clips, vs 48.4% naive single-model baseline (+33.6% improvement).

**Label Distribution:**
- Calm: 199 clips (44.6%)
- Stressed: 92 clips (20.6%)  
- Tired: 155 clips (34.8%)

**Per-Driver Calibration:** 20 driver baselines fitted from 199 Calm-labelled clips.

---

## Honest limitations

- Off-the-shelf SER accuracy on compressed, engine-noise-saturated radio audio is poor.
  That is the premise of the project, not a defect — it is why fusion exists.
- The lead–lag correlation is computed over 446 analysed clips across 5 sessions.
  With this sample size it is **indicative, not conclusive**, and the UI says so wherever
  the number appears.
- `distil-whisper/distil-small.en` does not produce word-level timestamps, so the `speech_rate` prosody feature falls back to population prior (z-score 0.0). The other 7 prosody features are fully calibrated per driver.
- Public broadcast audio, used for analysis and demonstration. No driver is diagnosed;
  the output is decision support for engineers, not a medical or disciplinary judgement.

---

## Colour

The palette is validated, not eyeballed. Categorical slots 1–3 clear every gate
all-pairs against the `#12120f` surface (worst CVD ΔE 9.4, worst normal-vision ΔE 20.9,
all ≥3:1 contrast). Mood uses status colours, whose red/green pair **fails** CVD
separation (ΔE 4.1 deutan) — so mood is never encoded by colour alone: every use pairs
it with the word, and chart marks are shape-coded too (circle / triangle / square).
