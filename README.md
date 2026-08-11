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
| `GP_USE_FIXTURES` | `1` | serve synthetic data; set `0` once the pipeline lands |
| `GP_OFFLINE` | `0` | forbid any network call at inference time |
| `GP_STT_MODEL` | `openai/whisper-small` | override without touching code |
| `GP_SER_MODEL` | `superb/wav2vec2-base-superb-er` | |

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

**Consumed:** Whisper (STT) · wav2vec2 SER (acoustic emotion) · DistilRoBERTa
(text emotion) · VAD segmentation.

**Contributed back:** our curated radio-stress dataset, and a Space running this demo.

---

## Honest limitations

- Off-the-shelf SER accuracy on compressed, engine-noise-saturated radio audio is poor.
  That is the premise of the project, not a defect — it is why fusion exists.
- The lead–lag correlation is computed over ~100 labelled clips. It is **indicative,
  not conclusive**, and the UI says so wherever the number appears.
- Public broadcast audio, used for analysis and demonstration. No driver is diagnosed;
  the output is decision support for engineers, not a medical or disciplinary judgement.

---

## Colour

The palette is validated, not eyeballed. Categorical slots 1–3 clear every gate
all-pairs against the `#12120f` surface (worst CVD ΔE 9.4, worst normal-vision ΔE 20.9,
all ≥3:1 contrast). Mood uses status colours, whose red/green pair **fails** CVD
separation (ΔE 4.1 deutan) — so mood is never encoded by colour alone: every use pairs
it with the word, and chart marks are shape-coded too (circle / triangle / square).
