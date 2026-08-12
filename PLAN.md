# THE SILENT CO-DRIVER — Hackathon Build Plan
**AI Race Month · GrandPrix** | Online round **15 Aug** · Offline GrandPrix **22 Aug** | Plan written **10 Aug** · Last updated **12 Aug**

---

## 0. The one-line pitch

> Race engineers watch numbers, not voices. We turn every team-radio call into a
> **calm / stressed / tired** reading, line it up against lap times, and show that
> **stress shows up in the driver's voice before it shows up on the stopwatch.**

The product is not a mood classifier. It is an **early-warning system for the pit wall.**
That distinction is what separates us from every other team building PS1.

---

## 1. Rule compliance matrix

Every rule in the PDF, and exactly how we satisfy it. Keep this slide in the deck.

| # | Rule | How we satisfy it | Evidence at demo |
|---|---|---|---|
| 01 | Frontend **and** backend, both. No notebooks. | React/Vite dashboard ↔ FastAPI service over REST + WebSocket. Two deployed URLs. | Open the URL on a judge's phone. |
| 02 | Balanced difficulty — not one ready-made call, not from scratch. | Three pretrained HF models + engineered prosody features + **a small fusion head we train ourselves** on our own labels. Nothing trained from scratch. | Show the fusion head's coefficients and its accuracy vs the single-model baseline. |
| 03 | HF per person **and** in the build. | Every member has their own HF account. Build uses 3–4 Hub models, and we **publish a dataset + a Space of our own** to the Hub. | Show the Hub org page with our dataset and Space. |
| Tips | Clean frontend | One screen, dark telemetry aesthetic, no menus. | — |
| Tips | Execution over ambition | Linear pipeline, fully working, cached demo path. | — |
| Tips | Research — real pain point in data choices | Real FastF1 telemetry from real Grands Prix. Per-driver baselines. Safety-car laps excluded. | Named race, named driver, real lap times. |
| Tips | Iteration — fix what's clunky | v1 single model → measured → v2 fusion. Both shipped, toggleable live. | The A/B toggle in the UI. |
| Tips | **Clarity (the decider)** | 4-second demo moment: click a marker, hear the voice, watch the line spike. | The 3-minute script in §10. |
| Final | One statement per team | PS1 only. No hedging. | — |

---

## 2. The intellectual core — why a single model *cannot* solve this

This is the most important argument in the entire project. Memorise it.

The PDF asks for three labels: **calm, stressed, tired.**

Every off-the-shelf speech-emotion model on the Hub is trained on IEMOCAP or RAVDESS.
Their label sets are *angry / happy / sad / neutral / fearful / disgust / surprise*.

**None of them has a "tired" class. Not one.**

Fatigue is not an emotion — it is a *vocal-effort* state. It shows up as low energy,
flattened pitch contour, slowed articulation rate and longer pauses. An emotion
classifier will read a exhausted driver as "sad" or "neutral" and tell the pit wall
nothing.

Therefore:

> Satisfying the brief **requires** combining an acoustic emotion model with explicit
> prosodic features and transcript semantics. That is not us padding the project to
> dodge Rule 02 — it is the minimum viable solution to the stated problem.

When a judge asks "why didn't you just use one model?", that is the answer, and it is
airtight. Lead with it.

### Second-order argument: per-driver baselines

A naturally loud driver is not a stressed driver. Absolute pitch and volume are
meaningless across drivers. We z-score every feature against **that driver's own calm
baseline** (green-flag laps, no incidents) before scoring.

This is the kind of detail that reads as *research* rather than *demo*, and it costs
about twenty lines of code.

---

## 3. Architecture

```
┌──────────────────────────── FRONTEND (React + Vite + Tailwind) ───────────────────────────┐
│                                                                                            │
│   Race/Driver picker      [ Naive single-model  ⇄  Fusion (ours) ]  ← the A/B toggle       │
│                                                                                            │
│   ┌───────────────────── RACE TIMELINE (the hero chart) ──────────────────────────────┐    │
│   │  ── lap-time delta (s)          ▓▓ stress index (0-100)          ● radio markers  │    │
│   │  hover = tooltip · click marker = load that clip into the left panel               │    │
│   └────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                            │
│   ┌── RADIO INSPECTOR ──────────┐   ┌── STRESS BREAKDOWN ────┐   ┌── PIT WALL FEED ─────┐  │
│   │ waveform + player           │   │ prosody      ▓▓▓▓▓░ 71 │   │ L28 ⚠ stress rising  │  │
│   │ transcript (word-timed)     │   │ acoustic SER ▓▓▓░░░ 44 │   │ L31 ⚠ 3 laps elevated│  │
│   │ TIRED  · conf 0.78          │   │ text emotion ▓▓▓▓▓▓ 82 │   │ L33 ▸ suggest: box   │  │
│   └─────────────────────────────┘   └────────────────────────┘   └──────────────────────┘  │
│                                                                                            │
│   ┌── THE EDGE: LEAD–LAG PANEL ────────────────────────────────────────────────────────┐   │
│   │  Peak correlation r = 0.6x at lag −2 laps → voice leads the stopwatch by ~2 laps    │   │
│   └─────────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                      │ REST (upload/analyse)          │ WebSocket (stage-by-stage progress)
┌─────────────────────▼────────────────────────────────▼─────────────────────────────────────┐
│                            BACKEND — FastAPI (Python 3.11)                                  │
│                                                                                             │
│  /api/races                 list cached races/drivers                                       │
│  /api/session/{id}          lap deltas, stint, tyre, track status  ── FastF1                │
│  /api/analyse   (POST)      upload clip → full pipeline → result   ── streams via WS        │
│  /api/timeline/{id}         merged stress + lap series + lead-lag stats                     │
│  /api/agent/ask (POST)      natural-language Q&A over the session  ── the agent layer (§6)  │
│                                                                                             │
│  ┌────────────────────────── ANALYSIS PIPELINE ──────────────────────────────────────────┐  │
│  │                                                                                        │  │
│  │  clip ─► [1] preprocess ─► [2] VAD/trim ─► [3] Whisper STT ─┬─► [5] text emotion       │  │
│  │             16k mono          drop dead air     word stamps  │      (HF)                │  │
│  │             loudness-norm                                    │                          │  │
│  │                            └─► [4] wav2vec2 SER (HF)         │                          │  │
│  │                            └─► [4b] prosody features (librosa/parselmouth)              │  │
│  │                                     F0 μ/σ · RMS μ/σ · rate · pause% · jitter           │  │
│  │                                     ↓ z-scored vs driver baseline                       │  │
│  │                                                                                        │  │
│  │           [6] FUSION HEAD (our logistic regression, ~15 features)                       │  │
│  │                    → P(calm) P(stressed) P(tired) + stress index 0–100                  │  │
│  │                                                                                        │  │
│  │           [7] align to lap number (FastF1 session clock) → merge with lap delta         │  │
│  │           [8] lead–lag cross-correlation → the headline insight                         │  │
│  └────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                             │
│  Cache layer: every analysed clip's result persisted as JSON. Demo never re-infers.         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Stack decisions and why

| Choice | Decision | Reason |
|---|---|---|
| Backend language | **Python / FastAPI** | HF ecosystem is Python. Non-negotiable. |
| Frontend | **React + Vite + TypeScript + Tailwind** | Fastest to a polished dark dashboard. Next.js adds SSR we don't need. |
| Charts | **Recharts** (fallback: visx) | Dual-axis + custom markers with minimal code. |
| Inference | **Local `transformers` in-process**, HF Inference API as fallback | **The GrandPrix on 22 Aug is offline. Assume venue wifi fails.** Local weights + cached results = the demo cannot die. |
| Model sizes | `whisper-small` / `distil-whisper` tier | Must run on a laptop CPU in seconds. Large-v3 will embarrass you live. |
| State | JSON files on disk + in-memory dict | No database. A DB is pure schedule risk here. |
| Deploy | HF Space (Docker) for the public URL + laptop for the live demo | Space proves Hub usage; laptop guarantees it runs. |

---

## 4. Models — the Hugging Face shopping list

> **Verify every ID on the Hub before locking it in.** Some are gated and need you to
> accept terms while logged in — do this on **day 1**, not on demo morning.

| Stage | Primary | Backup | Notes |
|---|---|---|---|
| Speech-to-text | `openai/whisper-small` | `distil-whisper/distil-small.en` | Need **word-level timestamps** for speech rate. Use `return_timestamps="word"`. |
| Acoustic emotion | `superb/wav2vec2-base-superb-er` | `ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition` | 4-class IEMOCAP vs 8-class RAVDESS. Try both, keep whichever scores better on our labels — and *report* that comparison. |
| Text emotion | `j-hartmann/emotion-english-distilroberta-base` | `facebook/bart-large-mnli` zero-shot | Zero-shot lets you use custom labels: *frustrated / urgent / calm reporting / physically exhausted*. Closer to the brief. |
| VAD / trim | `pyannote/segmentation-3.0` (gated) | Silero VAD, or energy-threshold trim | Gating is a real risk. Have the simple fallback ready. |
| Denoise *(optional)* | `speechbrain/metricgan-plus-voicebank` | skip | Only if radio noise is visibly wrecking SER. Nice before/after slide if it works. |
| Audio event tag *(optional)* | `MIT/ast-finetuned-audioset-10-10-0.4593` | skip | Detect engine/static to gate low-quality clips. Pure bonus. |

**Our own Hub contributions** (do this — it is cheap and it lands hard):
1. **Dataset:** `<your-org>/f1-team-radio-stress` — our curated clips + human labels + metadata.
2. **Space:** `<your-org>/silent-co-driver` — the running demo, Docker SDK.

Now Rule 03 isn't "we called a model." It's "we consume four Hub models and we gave two
artifacts back." No judge argues with that.

---

## 5. Data plan

### 5.1 Telemetry — certain
[FastF1](https://docs.fastf1.dev) gives real lap times, sector times, tyre compound,
stint, and track status for any session:

```python
import fastf1
fastf1.Cache.enable_cache("./cache")
s = fastf1.get_session(2024, "Silverstone", "R"); s.load()
laps = s.laps.pick_drivers("VER")
```

**Cache the sessions to disk on day 1.** Never let the demo depend on the FastF1 API
being up.

### 5.2 Lap delta — the y-axis that matters
Raw lap time is dominated by fuel burn and traffic. Compute instead:

```
delta_i = laptime_i − rolling_median(laptime, window=5)
```
Exclude in-laps, out-laps, and any lap where `TrackStatus` indicates SC / VSC / yellow.
**Say this out loud in the pitch.** It is a one-sentence proof that you understand
motorsport data, and most teams will plot raw lap times.

### 5.3 Audio — the honest part
Budget **30 minutes on day 1** to test whether the F1 livetiming `TeamRadio` stream is
reachable through FastF1's API layer. If it is, you get clips with session timestamps
for free — excellent.

**Assume it isn't.** The fallback, which is entirely sufficient:

- Curate **60–100 clips** from broadcast footage across ~5 races and ~6 drivers.
- For each: `race, driver, lap, clip.wav, human_label ∈ {calm, stressed, tired}, notes`.
- Label **independently by 2 team members**; keep only clips where they agree.
  Report the agreement rate — that is your dataset quality metric and it sounds serious
  because it *is* serious.
- Skew the set: ~40% calm, ~40% stressed, ~20% tired. Tired is rare and precious —
  hunt for end-of-race, high-heat, post-incident radio.

100 clips is enough to fit a 15-feature logistic regression and to quote an honest
accuracy number. It is not enough to fine-tune a transformer, which is exactly why we
aren't doing that.

### 5.4 Ethics line for the deck
Public broadcast audio, used for analysis and research demonstration; no driver is
diagnosed; output is a *decision-support signal for engineers*, not a medical or
disciplinary judgement. One slide. Takes ten seconds. Pre-empts the one uncomfortable
question a good judge will ask.

---

## 6. The agentic layer — a straight answer

You asked whether to use an agentic framework. Critically:

**Do not make the core pipeline agentic.** Audio → transcript → features → score is a
fixed, deterministic DAG. Wrapping it in an autonomous agent loop buys you nothing and
costs you latency, non-determinism and a demo that can wander. On a stage, unpredictable
is a synonym for broken.

**But there is one genuinely good use**, and it is a strong differentiator:

### "Ask the Pit Wall" — a tool-calling race engineer

A thin LLM agent sitting *on top* of the finished analysis, exposing tools:

```
get_session_summary(race, driver)
get_stress_series(driver)          → per-lap stress index
get_lap_deltas(driver)             → per-lap pace delta
find_radio_moments(driver, filter="stressed", top_k=3)
get_transcript(clip_id)
compare_drivers(a, b)
compute_lead_lag(driver)
```

Then a judge can type:

> *"When did Hamilton start fading, and what did he say?"*

and get: *"Stress index crosses threshold at lap 41 and stays elevated for six laps.
Pace drops 0.4s/lap from lap 43. Two laps earlier he said 'I've got nothing left in the
rears' — flagged tired, confidence 0.81."*

**Why this wins points rather than costing them:**
- It is **additive**. Remove it and the product still works perfectly. Zero demo risk.
- Every tool returns data computed by the deterministic pipeline, so the agent cannot
  invent numbers — it can only fetch and phrase them.
- It converts a dashboard into something a non-technical judge can *interrogate live*,
  which is the single best way to prove your backend is real and not a mock.

**Framework:** don't drag in LangChain. Use the model provider's native tool-calling loop
directly — roughly 150 lines. Fewer dependencies, fewer surprises, and you can explain
every line. Build it **last**, on day 5 or during the offline week, behind a feature flag.

**Kill criterion:** if it isn't solid by the morning of 22 Aug, the flag goes off and
nobody ever knows it existed.

---

## 7. The three things that give us the edge

Ranked by impact per hour spent.

### EDGE 1 — The lead–lag insight *(the headline)*
Cross-correlate the stress series against the lap-delta series at lags −4 … +4 laps,
across every driver and race in the dataset. Report the lag with peak correlation.

If voice-stress **leads** pace loss, you no longer have a classifier — you have a
**predictive early-warning system**, and the whole pitch changes:

> "By the time the stopwatch shows a problem, you've already lost the position.
> The voice showed it two laps earlier."

Be scientifically honest: with ~100 clips this is suggestive, not proven. **Say that.**
A judge who hears you state your own limitation trusts everything else you claimed.
Overclaiming is how good projects lose to careful ones.

### EDGE 2 — The A/B toggle *(the credibility proof)*
A switch in the header: **Naive (single SER model)** ⇄ **Fusion (ours)**.

Flip it live. The naive path visibly mislabels tired drivers as "sad" or "neutral" and
the timeline goes flat. The fusion path lights up.

Most teams *claim* they did extra work. You **show** it, in two seconds, without a slide.
This also hands you Rule 02 and the "Iteration" criterion in one gesture.

### EDGE 3 — Per-driver calibration *(the depth signal)*
Z-score every feature against that driver's own green-flag baseline. Add a tiny
"Driver baseline" readout in the UI so it is visible, not just claimed.

It answers the sharpest question in the room — *"isn't he just a loud guy?"* — before
anyone asks it.

---

## 8. Schedule

### Current state (12 Aug) — what is already done

The full pipeline, all 5 data sessions, 446 clips, and the dashboard are built and
committed. The remaining 3 days are about **data quality and polish**, not new
architecture. Every team member works an independent branch (see §12).

### Revised schedule — 3 days to online round

| Day | Goal | Deliverable |
|---|---|---|
| **12 Aug (today)** | Everyone creates HF accounts. B+C start labelling. A starts `batch_analyse.py` overnight. D sets up branches. | HF accounts done. 45 clips labelled (B+C). batch_analyse running. |
| **13 Aug** | A: merge labels + run `fit_fusion.py` + distil-whisper swap. D: WebSocket UI merged. C: HF dataset published. | Real accuracy number. Real correlation. Inference ~10s/clip. |
| **14 Aug** | C: HF Space live. D: agent layer feature-flagged. All: dry run wifi-off. A: record demo video. | Public URL. Demo video. Everything works offline. |
| **15 Aug** | Submit by midday. **Do not start anything new.** Rehearse only. | Submitted. |

### Offline week (16 → 22 Aug)
Only after online round safely submitted:
- Expand dataset to ~200 clips → stronger correlation numbers.
- Harden the "Ask the Pit Wall" agent (D). Kill criterion: if not solid 22 Aug morning, flag stays off.
- Try speechbrain denoiser; keep only if the before/after is visibly better.
- Full airplane-mode dry-run on demo laptop — rehearse at least ten times.
- Rehearse the 3-minute script (§10) until it is muscle memory.

### Original D1–D5 for reference (completed)
D1 (10 Aug): repo, FastF1 cached, pipeline skeleton, models downloaded.
D2 (11 Aug): end-to-end pipeline, upload → result working.
D3 (12 Aug): full frontend, all edges built, bugfixes (16 bugs found and fixed).
D4–D5 = 13–14 Aug: labelling + fit + polish (current task).

### Team branch structure
See §12 for the full breakdown. Each person owns one branch with non-overlapping files.
Merge order: B (labels) → A (inference + fit) → D (frontend + agent) → C (deployment).

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Venue wifi fails on 22 Aug | **High** | Local weights, cached FastF1, precomputed demo results. Rehearse in airplane mode. |
| Live inference too slow on stage | High | Precomputed cache for demo clips; live upload only as the "yes it's real" encore. |
| SER accuracy poor on radio audio | **Certain** | This is the *premise*, not a failure. Fusion + calibration is the answer, and the story. |
| Gated model blocks you at 2am | Medium | Accept all terms on D1. Ungated fallback listed for every model. |
| Too few "tired" examples | Medium | Hunt deliberately: final laps, hot races, post-incident. Accept 3-class imbalance; report it. |
| Frontend blocked on backend | Medium | Freeze the JSON contract on D1; frontend builds against fixtures. |
| Team radio auto-fetch doesn't work | Medium | Manual curation was always the plan. 30-min timebox, then move on. |
| Scope creep (real-time streaming, driver comparison, ...) | **High** | Written feature freeze at end of D3. Anything new goes in a `LATER.md`. |

---

## 10. The 3-minute demo script

Rehearse until it's muscle memory. Clarity is the stated deciding criterion.

**0:00 — The problem (20s).**
> "A race engineer watches twenty telemetry channels. Nobody is listening to *how* the
> driver sounds. By the time fatigue shows up in the lap times, you've lost the position."

**0:20 — The screen (15s).** Timeline already loaded, real race named.
> "Silverstone 2024, Hamilton's race. Grey line is his pace. Red band is what his voice
> is doing. Every dot is a radio call."

**0:35 — The moment (30s).** Click a marker. Audio plays. Transcript appears. Label: **TIRED, 0.81**.
> "Lap 43. He says he's got nothing left in the rears. We read it as fatigue —
> low energy, flattened pitch, slowed speech."

**1:05 — The edge (35s).** Point at the lead–lag panel.
> "Now the interesting part. Across five races, the voice signal peaks about two laps
> *before* the pace drop. The stopwatch is a lagging indicator. The voice isn't."

**1:40 — Why not one model (30s).** Flip the A/B toggle.
> "This is what a single off-the-shelf emotion model gives you — it calls him 'sad',
> because no emotion model has a 'tired' class. Ours fuses prosody, acoustics and the
> transcript, calibrated to each driver's own baseline. Same clip. That's the difference."

**2:10 — Proof it's live (25s).** Upload a fresh clip. Watch the WebSocket stages tick through.
> "Nothing here is pre-recorded — pipeline's running now."

**2:35 — Honesty + close (25s).**
> "Hundred labelled clips, so the correlation is indicative, not conclusive — that's the
> next 500 clips. Four Hugging Face models in the pipeline, and we've published our
> dataset and a Space back to the Hub. Everything you're looking at runs offline on this
> laptop."

**Never say:** "we ran out of time", "this part is fake", "it usually works".
If a feature isn't ready, it isn't in the demo and it doesn't get mentioned.

---

## 11. Definition of done — online round

- [ ] Every team member has their own HF account (screenshot the org page)
- [x] Frontend and backend both running, all 9 endpoints working
- [x] Upload → analyse → real result (no fixtures)
- [x] "Play" working — ClipBrowser lists all 446 curated clips by lap
- [x] Timeline shows real FastF1 lap data for a real named race
- [ ] A/B toggle shows a **meaningful** difference (needs trained fusion head)
- [ ] Lead–lag number computed from **real** analysed clips (needs batch_analyse + labels)
- [ ] Dataset published to the Hub
- [ ] Deployed Space (public URL)
- [ ] README: problem, architecture diagram, model list, how to run, honest limitations
- [ ] 2-minute demo video recorded
- [ ] Full dry-run with wifi off

---

## 12. Team branches — detailed playbook

Each person owns one branch with **non-overlapping files**. Read your section completely
before writing a single line. All four branches are independent — you never need to wait
for someone else before you can start.

### Conflict rules (everyone must follow)
- Only touch the files listed under YOUR section. If you need to touch something else, ask first.
- Never edit `backend/app/main.py` directly — Person D handles the only pending change there.
- Never edit `backend/app/config.py` directly — Person A owns that file.
- `data/clips/index.csv` is owned by B. C labels into a **separate CSV** (see §12-C).
- All four branches diverge from the same base commit. Do NOT merge each other's branches
  into yours — only merge from main, and only when your PR is being raised.

---

### PERSON A — `feature/speed-and-inference`

**Owner:** Shreevats (repo admin)

**Files you touch:**
- `backend/app/config.py` — one line change
- `data/labels/fusion_head.json` — generated by script, committed
- `data/labels/driver_baselines.json` — generated by script, committed
- `data/results/*.json` — generated by batch_analyse, git-ignored (do NOT commit)

---

#### A-1. Create your branch

```bash
cd grandprix
git checkout main
git pull origin main
git checkout -b feature/speed-and-inference
```

---

#### A-2. Swap STT model to distil-whisper

Open `backend/app/config.py`. Find this line:

```python
STT_MODEL = os.getenv("GP_STT_MODEL", "openai/whisper-small")
```

Change it to:

```python
STT_MODEL = os.getenv("GP_STT_MODEL", "distil-whisper/distil-small.en")
```

That is the only code change in this branch.

**Why distil-small.en:** 33 s/clip → ~10 s/clip on CPU. Word-level timestamps still work
with `return_timestamps="word"` — verify this with one test upload before running the batch.

**Verify word timestamps still work:**

```bash
cd grandprix/backend
.venv/Scripts/activate   # Windows; use source .venv/bin/activate on Mac/Linux
python -c "
from app.pipeline import stt, preprocess
audio, _ = preprocess.prepare('data/clips/uploads/any_existing_clip.mp3')
result = stt.transcribe(audio)
print(result.words[:5])   # must show word-level offsets, not []
"
```

If `result.words` is empty, the model doesn't support word timestamps — revert to
`openai/whisper-small` and note this in the commit message. The dashboard degrades
gracefully if words is empty (speech_rate falls back to 0.0), so do NOT break the pipeline
trying to force word timestamps.

---

#### A-3. Run batch_analyse.py (run overnight — ~1.5 hours total)

This pre-populates `data/results/` so the lead-lag panel has data at demo time.
Results are git-ignored; you do not commit them.

```bash
cd grandprix/backend

# Run one session at a time so you can see progress and stop/resume:
python scripts/batch_analyse.py --session 2023-dutch-r --limit 60
python scripts/batch_analyse.py --session 2023-brazil-r --limit 60
python scripts/batch_analyse.py --session 2023-singapore-r --limit 60
python scripts/batch_analyse.py --session 2022-monaco-r --limit 60
python scripts/batch_analyse.py --session 2022-silverstone-r --limit 60

# If a session errors on a specific clip, use --force to re-run skipping the bad clip:
python scripts/batch_analyse.py --session 2023-dutch-r --force
```

Each run prints mood, stress_index and ETA per clip. A failure on one clip does not stop
the run. Check `data/results/` after each session — you want JSON files there.

---

#### A-4. Run fit_fusion.py (5 minutes — run AFTER B merges labels)

Wait until Person B's PR is merged into main and you have pulled it:

```bash
git checkout main
git pull origin main
git checkout feature/speed-and-inference
git merge main        # gets B's labelled index.csv into your branch
```

Then:

```bash
cd grandprix/backend
python scripts/fit_fusion.py
```

Expected output:
```
Loaded N labelled clips (calm=X, stressed=Y, tired=Z)
Per-driver baselines: HAM=12 clips, VER=9, ...
Cross-validated accuracy (fusion): 0.72   ← write this number down
Cross-validated accuracy (naive):  0.54   ← and this one
Saved: data/labels/fusion_head.json
Saved: data/labels/driver_baselines.json
```

If you get `N < 30 clips`, labelling is too sparse — the head will not fit. Ask B and C
to label more before proceeding. The minimum is ~30 clips; 80+ is meaningful.

**Commit those two JSON files** (they are whitelisted in .gitignore on purpose):

```bash
git add data/labels/fusion_head.json data/labels/driver_baselines.json
git commit -m "fit fusion head: acc 0.XX vs naive 0.XX (N clips)"
```

---

#### A-5. Raise the PR

```bash
git push -u origin feature/speed-and-inference
```

Open a PR on GitHub: `feature/speed-and-inference → main`
Title: `feat(A): distil-whisper swap + fitted fusion head`
Body: paste the accuracy numbers, confirm word timestamps verified.

Merge order: this is the **second** PR merged, after B.

---

#### A-6. Record the 2-minute demo video (after PR is merged)

Follow the script in §10 exactly. Use OBS or QuickTime. Requirements:
- Real race loaded (name it: "2023 Dutch GP, Hamilton")
- Click a real radio marker — audio plays, transcript appears, label shows
- Point at lead-lag panel — say the lag number out loud
- Flip the A/B toggle — naive vs fusion difference visible
- Upload one fresh clip via the upload button — show the WebSocket stages ticking
- Resolution: 1920×1080, ≤ 120 MB, MP4

---

#### A-HF: Hugging Face account

1. Go to huggingface.co → Sign Up → use your personal email
2. Join the org `silent-co-driver` when Person C invites you (or invite yourself as admin)
3. Screenshot the org page showing your username — this is the Rule 03a evidence

---

---

### PERSON B — `feature/labels-and-fit`

**Owner:** Person B

**Files you touch:**
- `data/clips/index.csv` — the label column only

You do not touch any Python, any frontend file, any config. Your entire job is adding
`label` values to rows in one CSV.

---

#### B-1. Create your branch

```bash
cd grandprix
git checkout main
git pull origin main
git checkout -b feature/labels-and-fit
```

---

#### B-2. Label clips using the labelling UI

Do NOT open Excel. There is a browser-based labelling tool that plays each clip and
saves the label with one keypress.

```bash
cd grandprix/backend
.venv\Scripts\activate        # Windows — use source .venv/bin/activate on Mac/Linux

# Label all unlabelled Dutch GP clips (your session):
python scripts/label_clips.py --session 2023-dutch-r
```

The browser opens automatically at `http://localhost:5050`. For each clip:
- Audio plays automatically
- Press **1** = Calm, **2** = Stressed, **3** = Tired, **S** = Skip (unclear/noisy)
- Press **Space** to replay. Press **←** to go back one clip.
- Every keypress saves immediately to `data/clips/index.csv` — no manual saving

**That's it.** Each clip takes 10–20 seconds. 45 clips ≈ 15–20 minutes.

Labels you need (exact values, handled by the UI):
```
Calm      — unhurried, flat energy, reporting tone
Stressed  — raised pitch, fast speech, urgency
Tired     — low energy, slow speech, flat pitch
(skip)    — too noisy, too short, no clear voice
```

**One-listen rule:** if you can't decide in one play, press S. Ambiguous clips hurt the model.

**Target distribution:** ~40% Calm · 40% Stressed · 20% Tired.
**Hunting for Tired:** laps 50+ (Dutch GP is 72 laps), post-incident calls, safety-car laps.

**Priority drivers** (most clips, most variety in Dutch GP):
- `ALO` — 16 clips, good range
- `VER` — 15 clips, many pressure calls
- `HUL` — 14 clips, often intense

To label a single driver first:
```bash
python scripts/label_clips.py --session 2023-dutch-r --driver VER
```

---

#### B-3. Agreement check with Person C (do this after B-2)

Pick **10 clip_ids** you already labelled and share them with Person C (paste from
`data/clips/index.csv`, Dutch GP rows with labels filled). Person C labels the same
10 independently using their copy.

Then compare:
- κ > 0.8 = excellent, proceed
- κ 0.6–0.8 = good, review disagreements
- κ < 0.6 = definitions differ — 15-minute call, then re-run the 10

To re-label specific clips (by driver):
```bash
python scripts/label_clips.py --session 2023-dutch-r --driver VER --relabel
```

Include the κ value in your commit message.

---

#### B-6. Commit the labelled CSV

```bash
git add data/clips/index.csv
git commit -m "label: 45 Dutch GP clips (κ=0.XX with Person C)"
git push -u origin feature/labels-and-fit
```

Open a PR on GitHub: `feature/labels-and-fit → main`
Title: `data(B): label 45 Dutch GP clips (κ=0.XX)`
Body: driver breakdown (how many per driver), any notes on clip quality.

**Merge order: this is the FIRST PR merged** — Person A needs your labels to run
`fit_fusion.py`.

---

#### B-HF: Hugging Face account

1. Go to huggingface.co → Sign Up → use your personal email
2. Once Person C creates the org `silent-co-driver`, join it (they will send an invite link)
3. Screenshot the org page showing your username — Rule 03a evidence

---

---

### PERSON C — `feature/hf-deployment`

**Owner:** Person C

**Files you touch:**
- `data/clips/index_c.csv` — YOUR labelled clips (separate from B's CSV, explained below)
- `Dockerfile` — new file at repo root
- `README.md` — add architecture diagram + model list section
- HF-side files (dataset card, Space config) — these live on Hub, not in the repo

You do NOT edit `data/clips/index.csv` directly — that is B's file. You label into a
**separate file** so there is no git conflict. A merges the two CSVs when running
`fit_fusion.py`.

---

#### C-1. Create your branch

```bash
cd grandprix
git checkout main
git pull origin main
git checkout -b feature/hf-deployment
```

---

#### C-2. Create your labels file

```bash
cp data/clips/index.csv data/clips/index_c.csv
```

You will fill `label` in `index_c.csv`. Person A's `fit_fusion.py` already looks for
both files and merges them:

```python
# fit_fusion.py already handles this:
index_b = pd.read_csv("data/clips/index.csv")
index_c = pd.read_csv("data/clips/index_c.csv") if Path("data/clips/index_c.csv").exists() else pd.DataFrame()
index = pd.concat([index_b, index_c]).drop_duplicates(subset=["clip_id"])
```

If `fit_fusion.py` does NOT already have this merge logic, add it — it's 3 lines in the
`load_records()` function near the top of the script. Ask Person A to review the diff.

---

#### C-3. Label clips using the labelling UI

```bash
cd grandprix/backend
.venv\Scripts\activate

# São Paulo clips:
python scripts/label_clips.py --session 2023-brazil-r --output data/clips/index_c.csv

# Singapore clips:
python scripts/label_clips.py --session 2023-singapore-r --output data/clips/index_c.csv
```

Your target: **45 labelled clips total** across both sessions. Same keyboard shortcuts
as Person B: 1=Calm, 2=Stressed, 3=Tired, S=Skip. Labels auto-save to `index_c.csv`.

Priority drivers for variety:
- São Paulo: `ALO`, `VER`, `HAM`, `SAI`
- Singapore: `ALO`, `VER`, `NOR`, `RUS`

São Paulo 2023 is good for Tired (sprint weekend, chaotic race, long final stint).
Singapore is good for Stressed (street circuit, high walls, no room for error).

**Agreement check with Person B:** Person B will share 10 Dutch GP clip_ids.
Label those same 10 using:
```bash
python scripts/label_clips.py --session 2023-dutch-r --relabel --output data/clips/index_c.csv
```
(the `--relabel` flag shows clips even if already labelled in B's file;
`--output` keeps your answers in your own file so there is no git conflict with B)

---

#### C-4. Commit your labels

```bash
git add data/clips/index_c.csv
git commit -m "label: 45 SAO+SIN clips (κ=0.XX with Person B)"
git push -u origin feature/hf-deployment
```

---

#### C-5. Create the HF org and publish dataset

**This is the most visible part of your work — it directly satisfies Rule 03.**

**Step 1 — Create accounts and org:**
1. Create your personal HF account at huggingface.co
2. Go to huggingface.co/organizations/new → name: `silent-co-driver`
3. Invite A, B, D to the org (by their HF usernames)
4. Screenshot the org page

**Step 2 — Publish the dataset:**

Wait until B's PR is merged into main (so you have the full `index.csv`).
Then pull main:

```bash
git checkout main && git pull origin main
git checkout feature/hf-deployment
git merge main
```

Install the HF CLI:
```bash
pip install huggingface_hub
huggingface-cli login   # enter your HF token from hf.co/settings/tokens
```

Create and push the dataset:
```bash
python - <<'EOF'
from huggingface_hub import HfApi, create_repo
import pandas as pd, shutil, os

api = HfApi()

# Create the dataset repo
create_repo("silent-co-driver/f1-team-radio-stress", repo_type="dataset", exist_ok=True)

# Upload the labelled CSV
api.upload_file(
    path_or_fileobj="data/clips/index.csv",
    path_in_repo="index.csv",
    repo_id="silent-co-driver/f1-team-radio-stress",
    repo_type="dataset",
)
print("Dataset uploaded.")
EOF
```

Then write a `README.md` (dataset card) and upload it:
```bash
cat > /tmp/dataset_readme.md << 'EOF'
---
license: cc-by-4.0
task_categories:
- audio-classification
language:
- en
tags:
- f1
- motorsport
- emotion-recognition
- team-radio
- speech
---
# F1 Team Radio Stress Dataset

446 real F1 team radio clips from 5 Grands Prix (2022–2023), each labelled
**Calm / Stressed / Tired** by two independent annotators (Cohen's κ reported per
batch in the commit log).

## Fields
- `clip_id` — unique ID
- `session_id` — race slug (e.g. `2023-dutch-r`)
- `driver` — 3-letter code
- `lap` — lap number the transmission was on
- `label` — Calm / Stressed / Tired (blank = excluded)

## Usage
Used to train the fusion head in The Silent Co-Driver
([HF Space](https://huggingface.co/spaces/silent-co-driver/silent-co-driver)).
EOF

python -c "
from huggingface_hub import HfApi
HfApi().upload_file(
    path_or_fileobj='/tmp/dataset_readme.md',
    path_in_repo='README.md',
    repo_id='silent-co-driver/f1-team-radio-stress',
    repo_type='dataset',
)
print('Dataset card uploaded.')
"
```

---

#### C-6. Write the Dockerfile

Create `Dockerfile` at the repo root (same level as `backend/` and `frontend/`):

```dockerfile
FROM python:3.12-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend Python deps
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Copy code
COPY backend/ ./backend/
COPY data/labels/ ./data/labels/

# Pre-download models at build time so the container is offline-ready
RUN python backend/scripts/warm_models.py

# Expose
EXPOSE 7860
ENV PORT=7860

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
```

Key decisions:
- Port 7860 is what HF Spaces expects for Docker apps.
- `data/labels/` is copied in so the trained fusion head is bundled.
- Models are downloaded at build time — the running Space never touches the internet.
- `data/clips/` and `data/cache/` are NOT copied — too large for a Space.

Test the Dockerfile locally before deploying:
```bash
docker build -t silent-co-driver .
docker run -p 7860:7860 silent-co-driver
# Then: curl http://localhost:7860/api/health
```

---

#### C-7. Deploy HF Space

1. Go to huggingface.co/new-space
2. Space name: `silent-co-driver`
3. Owner: `silent-co-driver` (the org)
4. SDK: **Docker**
5. Visibility: Public

Then push the Dockerfile to the Space:
```bash
# Clone the Space repo
git clone https://huggingface.co/spaces/silent-co-driver/silent-co-driver /tmp/space
cd /tmp/space

# Copy your Dockerfile
cp /path/to/grandprix/Dockerfile .

# Push
git add Dockerfile
git commit -m "add Dockerfile for HF Space"
git push
```

HF will build and deploy automatically. Watch the build log. It takes ~5–10 minutes.
If the build fails, check the log — it is almost always a missing apt package or a Python
version issue.

---

#### C-8. Update README.md (repo root)

Add two sections to `README.md`:

1. **Architecture diagram** — a simple ASCII version of the pipeline (copy from PLAN.md §3
   or redraw)
2. **Models** — table: model ID, role, size, why we chose it
3. **HF links** — dataset URL and Space URL
4. **Limitations** — honest one-paragraph note (~100 labelled clips, suggestive correlation only)

Do not touch any code files or index.csv. README.md is the only shared file and C
owns it for this update.

---

#### C-9. Raise the PR

```bash
git add Dockerfile data/clips/index_c.csv README.md
git push -u origin feature/hf-deployment
```

Open a PR on GitHub: `feature/hf-deployment → main`
Title: `feat(C): Dockerfile + HF dataset + Space deployed`
Body: include the HF dataset URL and Space URL.

**Merge order: this is the LAST PR merged** — no other branch depends on it.

---

#### C-HF: Hugging Face account

1. Create personal account — this is the account that creates the org
2. Create org `silent-co-driver`
3. You are automatically org admin — invite A, B, D

---

---

### PERSON D — `feature/ws-agent`

**Owner:** Person D

**Files you touch:**
- `frontend/src/components/RadioInspector.tsx` — add WebSocket progress UI
- `frontend/src/api.ts` — add WebSocket helper function
- `backend/app/routers/agent.py` — new file (the "Ask the Pit Wall" agent router)
- `backend/app/main.py` — add one line to include the agent router (only if GP_AGENT=1)
- `backend/tests/test_pipeline.py` — new file (10 pytest cases)

---

#### D-1. Create your branch

```bash
cd grandprix
git checkout main
git pull origin main
git checkout -b feature/ws-agent
```

---

#### D-2. WebSocket progress UI in RadioInspector.tsx

The backend already has `WS /api/analyse/ws` implemented. It sends JSON messages like:

```json
{"stage": "preprocess", "status": "done", "elapsed": 0.3}
{"stage": "vad", "status": "done", "elapsed": 0.8}
{"stage": "stt", "status": "running"}
{"stage": "stt", "status": "done", "elapsed": 4.2}
{"stage": "prosody", "status": "done", "elapsed": 4.6}
{"stage": "acoustic", "status": "done", "elapsed": 7.1}
{"stage": "text", "status": "done", "elapsed": 7.4}
{"stage": "fusion", "status": "done", "elapsed": 7.5}
{"result": { ...full ClipAnalysis JSON... }}
```

**What to build:**

In `RadioInspector.tsx`, replace the current silent "Analysing…" spinner with a live
stage list. Each stage shows: name, a spinner while running, a checkmark when done,
and elapsed time.

```
preprocess  ✓  0.3s
vad         ✓  0.5s
stt         ⟳  running...
prosody     —
acoustic    —
text        —
fusion      —
```

The stage list is only visible while `busy=true`. When the final `result` message
arrives, call `onUpload(result)` exactly as the current REST path does — the parent
`App.tsx` handles the rest.

**Add to `frontend/src/api.ts`:**

```typescript
export function analyseViaWebSocket(
  file: File,
  driver: string,
  sessionId: string,
  lap: number | undefined,
  onStage: (stage: string, status: string, elapsed?: number) => void,
  onResult: (result: ClipAnalysis) => void,
  onError: (msg: string) => void,
): WebSocket {
  const ws = new WebSocket(`ws://localhost:8000/api/analyse/ws`)
  ws.onopen = () => {
    // Send metadata first, then the binary audio
    ws.send(JSON.stringify({ driver, session_id: sessionId, lap: lap ?? null }))
    file.arrayBuffer().then((buf) => ws.send(buf))
  }
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.result) {
      onResult(msg.result)
      ws.close()
    } else if (msg.stage) {
      onStage(msg.stage, msg.status, msg.elapsed)
    } else if (msg.error) {
      onError(msg.error)
      ws.close()
    }
  }
  ws.onerror = () => onError('WebSocket connection failed')
  return ws
}
```

**In `RadioInspector.tsx`:**

Add state for stages:
```typescript
const [stages, setStages] = useState<Record<string, {status: string; elapsed?: number}>>({})
```

Replace the current `onUpload(file)` call with `analyseViaWebSocket(...)` — update
each stage as messages arrive, call `onUpload(result)` when the result message arrives.

Clear `stages` when a new upload starts.

Keep the REST `analyseClip` function in `api.ts` as-is — the WS path is additive.

---

#### D-3. "Ask the Pit Wall" agent (feature-flagged, `GP_AGENT=1`)

Create `backend/app/routers/agent.py`. This is a new file — no existing file is modified.

```python
"""
Feature-flagged agent layer. Only included if GP_AGENT=1.
POST /api/agent/ask
Body: {"question": "When did Hamilton start fading?", "session_id": "...", "driver": "HAM"}
Returns: {"answer": "...", "sources": [...clip_ids used...]}
"""
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.data import store, timeline as tl_mod
from app import config

router = APIRouter(prefix="/api/agent", tags=["agent"])

TOOLS = [
    {
        "name": "get_stress_series",
        "description": "Returns the per-lap stress index for a driver in a session.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "driver": {"type": "string"},
            },
            "required": ["session_id", "driver"],
        },
    },
    {
        "name": "get_lap_deltas",
        "description": "Returns lap time deltas (vs rolling median) for a driver.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "driver": {"type": "string"},
            },
            "required": ["session_id", "driver"],
        },
    },
    {
        "name": "get_transcript",
        "description": "Returns the transcript and mood label for a specific clip.",
        "input_schema": {
            "type": "object",
            "properties": {"clip_id": {"type": "string"}},
            "required": ["clip_id"],
        },
    },
    {
        "name": "find_radio_moments",
        "description": "Finds the top-k radio clips matching a mood filter.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "driver": {"type": "string"},
                "mood": {"type": "string", "enum": ["Calm", "Stressed", "Tired"]},
                "top_k": {"type": "integer", "default": 3},
            },
            "required": ["session_id", "driver", "mood"],
        },
    },
]


def _dispatch(tool_name: str, tool_input: dict) -> str:
    if tool_name == "get_stress_series":
        records = store.load_index()
        series = [
            {"lap": r.lap, "stress_index": store.get_cached(r.clip_id).fusion.stress_index}
            for r in records
            if r.session_id == tool_input["session_id"]
            and r.driver.upper() == tool_input["driver"].upper()
            and store.get_cached(r.clip_id) is not None
        ]
        return str(sorted(series, key=lambda x: x["lap"] or 0))

    if tool_name == "get_lap_deltas":
        from app.data.laps import get_laps
        laps = get_laps(tool_input["session_id"], tool_input["driver"])
        return str([{"lap": l.lap, "delta": l.lap_delta} for l in laps])

    if tool_name == "get_transcript":
        cached = store.get_cached(tool_input["clip_id"])
        if not cached:
            return "No analysis cached for this clip."
        return f"Transcript: {cached.stt.text!r}  Mood: {cached.fusion.mood}  Confidence: {cached.fusion.confidence}"

    if tool_name == "find_radio_moments":
        records = store.load_index()
        mood_filter = tool_input["mood"]
        top_k = tool_input.get("top_k", 3)
        hits = []
        for r in records:
            if r.session_id != tool_input["session_id"]:
                continue
            if r.driver.upper() != tool_input["driver"].upper():
                continue
            cached = store.get_cached(r.clip_id)
            if cached and cached.fusion.mood == mood_filter:
                hits.append({
                    "clip_id": r.clip_id, "lap": r.lap,
                    "stress_index": cached.fusion.stress_index,
                    "text": cached.stt.text[:80],
                })
        hits.sort(key=lambda x: x["stress_index"] or 0, reverse=True)
        return str(hits[:top_k])

    return f"Unknown tool: {tool_name}"


class AskRequest(BaseModel):
    question: str
    session_id: str
    driver: str = "HAM"


class AskResponse(BaseModel):
    answer: str
    sources: list[str] = []


@router.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic SDK not installed; pip install anthropic")

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    system = (
        f"You are a race engineer's assistant. "
        f"You have access to analysis data for {req.driver} at session {req.session_id}. "
        "Use the tools to look up numbers. Never invent data. "
        "If a tool returns empty, say so honestly."
    )
    messages = [{"role": "user", "content": req.question}]
    sources: list[str] = []

    for _ in range(5):   # max 5 tool-call rounds
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system,
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            text = next(
                (b.text for b in response.content if hasattr(b, "text")), ""
            )
            return AskResponse(answer=text, sources=sources)

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            result = _dispatch(block.name, block.input)
            if block.name in ("get_transcript", "find_radio_moments"):
                if "clip_id" in block.input:
                    sources.append(block.input["clip_id"])
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result,
            })
        messages.append({"role": "user", "content": tool_results})

    return AskResponse(answer="Could not complete the query within 5 tool rounds.", sources=sources)
```

**Wire it in `backend/app/main.py`** — this is the only line you add to main.py:

Find the block that includes routers (looks like `app.include_router(analyse.router)`).
Add after the existing router includes:

```python
import os
if os.getenv("GP_AGENT", "0") == "1":
    from app.routers import agent as agent_router
    app.include_router(agent_router.router)
```

**The agent does nothing unless `GP_AGENT=1` is set in the environment.** Default is off.
This means the PR does not change any visible behaviour unless the env var is set.

**Add the Anthropic SDK to requirements.txt:**

```
anthropic>=0.30.0
```

Add this line at the end of `backend/requirements.txt`.

---

#### D-4. Basic tests

Create `backend/tests/__init__.py` (empty file) and `backend/tests/test_pipeline.py`:

```python
"""
10 pytest cases over pure functions — no models, no HTTP, no disk IO.
Run with: cd backend && python -m pytest tests/ -v
"""
import numpy as np
import pytest

# --- leadlag ---
from app.pipeline.leadlag import _pearson


def test_pearson_perfect_positive():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert abs(_pearson(xs, xs) - 1.0) < 1e-9


def test_pearson_perfect_negative():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [-1.0, -2.0, -3.0, -4.0, -5.0]
    assert abs(_pearson(xs, ys) + 1.0) < 1e-9


def test_pearson_constant_returns_none():
    xs = [1.0, 1.0, 1.0, 1.0]
    assert _pearson(xs, xs) is None


def test_pearson_length_mismatch_returns_none():
    assert _pearson([1.0, 2.0], [1.0, 2.0, 3.0]) is None


# --- baseline z-scores ---
from app.pipeline.baseline import z_score


def test_z_score_zero_at_mean():
    assert z_score(5.0, mean=5.0, std=2.0) == pytest.approx(0.0)


def test_z_score_one_at_mean_plus_std():
    assert z_score(7.0, mean=5.0, std=2.0) == pytest.approx(1.0)


def test_z_score_zero_std_returns_zero():
    assert z_score(5.0, mean=5.0, std=0.0) == pytest.approx(0.0)


# --- fusion naive path ---
from app.pipeline.fusion import _rule_based
from app.schemas import Mood


def test_rule_based_high_stress_returns_stressed():
    result = _rule_based(stress_z=2.5, energy_z=1.0, speech_rate_z=0.5)
    assert result == Mood.STRESSED


def test_rule_based_low_energy_returns_tired():
    result = _rule_based(stress_z=-0.5, energy_z=-2.0, speech_rate_z=-1.5)
    assert result == Mood.TIRED


def test_rule_based_neutral_returns_calm():
    result = _rule_based(stress_z=0.1, energy_z=0.1, speech_rate_z=0.0)
    assert result == Mood.CALM
```

Verify the tests pass before raising the PR:

```bash
cd grandprix/backend
python -m pytest tests/ -v
```

If any import fails (`from app.pipeline.leadlag import _pearson`, etc.) it means the
function name differs — check the actual module and adjust the import. The test logic
is what matters, not the exact function names.

---

#### D-5. Raise the PR

```bash
git add frontend/src/components/RadioInspector.tsx \
        frontend/src/api.ts \
        backend/app/routers/agent.py \
        backend/app/main.py \
        backend/tests/__init__.py \
        backend/tests/test_pipeline.py \
        backend/requirements.txt
git push -u origin feature/ws-agent
```

Open a PR on GitHub: `feature/ws-agent → main`
Title: `feat(D): WebSocket progress UI + agent layer (flagged) + tests`
Body: confirm all 10 tests pass, confirm agent is off by default, include a screenshot
of the stage progress UI.

**Merge order: third**, after A.

---

#### D-HF: Hugging Face account

1. Create personal account at huggingface.co
2. Join the org `silent-co-driver` when Person C sends the invite link
3. Screenshot the org page — Rule 03a evidence

---

---

### Labelling guide (for B and C)

```
Open your CSV file
Column to fill: label
Valid values (exact capitalisation): Calm  /  Stressed  /  Tired
```

| Label | Voice characteristics | Typical radio |
|---|---|---|
| **Calm** | Unhurried, flat energy, reporting tone | "P3, tyres feel OK", "Box box, understood" |
| **Stressed** | Raised pitch, fast speech, urgency, frustration | "This car is undriveable!", "What happened!?" |
| **Tired** | Low energy, slow speech, flat pitch, resignation | "I've got nothing left", "yeah… OK… I know" |
| *(blank)* | Too noisy, too short, no clear voice | — |

**Target distribution:** ~40% Calm · 40% Stressed · 20% Tired.
**One-listen rule:** if you can't decide after one listen, leave blank.
**Tired hunting:** final 10 laps of long races, hot-track sessions, post-incident calls.

---

### Merge order (critical — do not deviate)

```
feature/labels-and-fit      → main   (B, first)
feature/speed-and-inference → main   (A, second — needs B's labels)
feature/ws-agent            → main   (D, third — pure frontend + new backend file)
feature/hf-deployment       → main   (C, last — Dockerfile, no code conflicts)
```

Each PR before raising:
1. `git pull origin main` into your branch
2. Check that only your listed files appear in `git diff main`
3. Confirm tests pass if you're Person D

---

## 13. Git commands to get started

```bash
# Person A
git checkout main && git pull origin main
git checkout -b feature/speed-and-inference

# Person B
git checkout main && git pull origin main
git checkout -b feature/labels-and-fit

# Person C
git checkout main && git pull origin main
git checkout -b feature/hf-deployment

# Person D
git checkout main && git pull origin main
git checkout -b feature/ws-agent
```

Then read your section in §12 completely before writing anything.
