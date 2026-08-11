# THE SILENT CO-DRIVER — Hackathon Build Plan
**AI Race Month · GrandPrix** | Online round **15 Aug** · Offline GrandPrix **22 Aug** | Plan written **10 Aug**

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

### Online round — 5 days (10 → 15 Aug)

| Day | Goal | Deliverable at end of day |
|---|---|---|
| **D1 · Aug 10** | Foundations, in parallel. HF accounts for **everyone**. Accept gated model terms. FastF1 cached for 5 races. Repo + FastAPI + Vite skeleton talking to each other. Test the TeamRadio stream question. Start clip collection. | `/api/health` returns 200 from the React app. 20 clips collected. |
| **D2 · Aug 11** | Pipeline v1 end-to-end, ugly but complete. Whisper → SER → hardcoded weights → JSON. Lap-alignment logic. Clip collection continues to 60. | Upload a clip in the browser → get a label back. **This is the critical milestone.** |
| **D3 · Aug 12** | **Frontend day.** The hero timeline chart with real FastF1 deltas + stress overlay + clickable markers. Radio inspector panel. Dark F1 aesthetic locked. | The screenshot you would put on a poster. |
| **D4 · Aug 13** | **Science day.** Finish labelling (100 clips, 2 annotators). Extract prosody features. Fit the fusion head. Measure fusion vs naive. Build the A/B toggle. Compute lead–lag. | A real accuracy number and a real correlation number. |
| **D5 · Aug 14** | Harden + ship. Result cache. Loading/error states. Deploy HF Space. Publish dataset. README with architecture diagram. Record 2-min demo video. | Public URL + repo + video. |
| **Buffer · Aug 15** | Submission day. **Do not start anything new.** Rehearse, fix, submit early. | Submitted by midday. |

### Offline week (16 → 22 Aug)
Only after the online round is safely submitted:
- Build the **Ask the Pit Wall** agent (§6), feature-flagged.
- Expand the dataset to ~200 clips → stronger correlation numbers.
- Try the denoiser; keep only if the before/after is visibly better.
- Full offline dry-run: **airplane mode, laptop only.** If it doesn't run with wifi off, it isn't done.
- Rehearse the 3-minute script (§10) at least ten times.

### Roles (scale to your team size)
- **Pipeline** — audio, models, features, fusion. *The critical path.*
- **Frontend** — chart, panels, aesthetic. Starts D1 against mocked JSON, never blocked.
- **Data & story** — clip collection, labelling, FastF1, the deck, the pitch.
- **Fourth member** — second labeller + integration + deployment + demo operator.

If you are three: fold deployment into pipeline, and *everyone* labels on D4.

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
- [ ] Deployed frontend URL, reachable on a phone
- [ ] Deployed backend, or the Space running both
- [ ] Upload → analyse → result works on a clip the judges pick
- [ ] Timeline shows real FastF1 lap data for a real named race
- [ ] A/B toggle works and the difference is visible
- [ ] Lead–lag number computed from real data
- [ ] Dataset published to the Hub
- [ ] README: problem, architecture diagram, model list, how to run, honest limitations
- [ ] 2-minute demo video recorded
- [ ] Full dry-run with wifi off

---

## 12. Next step

Lock the architecture in §3, then scaffold in this order:
**repo → FastF1 cache → JSON contract → FastAPI skeleton → Vite skeleton → pipeline v1.**

The JSON contract comes before any real code, so the frontend is never blocked.
