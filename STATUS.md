# STATUS — The Silent Co-Driver

**As of 12 Aug 2026.** Online round **15 Aug (3 days)** · GrandPrix offline **22 Aug (10 days)**

Tracked against three sources of truth:
`PLAN.md` (our agreed plan) · `Grandprix Problem Statements.docx` (the brief) · `luma.pdf` (the rules deck)

---

## 1. One-line status

The product works end to end on real data — five real Grands Prix, 446 real team-radio
clips, four Hugging Face models, a live inference pipeline, a working dashboard, and a
clip browser. **What it cannot yet claim is accuracy**, because nothing is labelled and
the fusion head is untrained.

**~87% built, 0% validated.** Every remaining gap is either 30 minutes of code or
hours of labelling. The labelling is the critical path — it unlocks all four edges at once.

---

## 2. Brief compliance — the rules that decide eligibility

| # | Rule | Status | Evidence |
|---|---|---|---|
| 01 | Frontend **and** backend, both. No notebook-only. | ✅ **Met** | React/Vite dashboard ↔ FastAPI, 9 endpoints, live over HTTP |
| 02 | Balanced difficulty | ✅ **Met** | 4 pretrained Hub models + 8 engineered prosody features + our own fusion head fitted on our labels |
| 03a | Every team member has their own HF account | ❌ **NOT DONE — blocking** | 10 minutes. Everyone creates an account today. |
| 03b | Solution uses something from the Hub | ✅ **Met** | 4 models, 2.3 GB cached locally |
| — | One problem statement per team | ✅ | PS1 only |

> **03a is the only rule we currently fail.** Everyone creates an account before any other task.

### The brief's five named deliverables

| Spec wording | Status |
|---|---|
| "**play** or upload a radio audio clip" | ✅ **Both paths now work.** `/api/clips/library` lists all 446 curated clips by lap; `ClipBrowser` component in the left column. Upload button + lap input always visible. |
| "converts the speech to text" | ✅ Whisper, word-level timestamps working (verified: 44 words, real offsets) |
| "shows if the driver seems calm, stressed, or tired" | ⚠️ **works, but unvalidated** — correct 3-class vocabulary, rule-based fallback until labels exist |
| "alongside basic lap-time information" | ✅ real FastF1 pace deltas, clean-lap rolling median |
| "visual showing if mood is **affecting** lap performance" | ⚠️ lead–lag panel **built and correct**, needs `data/results/` populated by `batch_analyse.py` |

---

## 3. What is built and working

### Data layer
| Item | Detail |
|---|---|
| Races | 5 sessions, 553 MB, offline-ready |
| Laps | 5,598 clean-lap deltas |
| Radio clips | 446, lap-mapped, on disk |
| Clip browser | GET /api/clips/library — lists all 446, filterable by session+driver |
| Result cache | data/results/ — empty until batch_analyse.py runs |

### Hugging Face models (Rule 03b)
| Role | Model | Warmed by |
|---|---|---|
| Speech-to-text | `openai/whisper-small` | `warm_models.py` |
| Acoustic emotion | `superb/wav2vec2-base-superb-er` | `warm_models.py` |
| Text emotion | `j-hartmann/emotion-english-distilroberta-base` | `warm_models.py` |
| VAD | `istupakov/silero-vad-onnx` | `warm_models.py` |

All four are warmed at boot by the FastAPI lifespan — including librosa's JIT, which was
costing ~20 s on the first upload.

### Pipeline — 11 modules
```
clip → preprocess → VAD ─┬─ Whisper STT ──→ text emotion ─┐
                         ├─ acoustic SER ─────────────────┤
                         └─ prosody (8 features) ─────────┤
                              z-score vs driver baseline
                                                          ▼
                                        fusion head + naive path
                                                          ▼
                              lap alignment → strategy calls → lead–lag
```

### Frontend — ~1,300 lines
Race + driver pickers · dual-panel timeline · **clip browser** · radio inspector (with
lap-number upload input) · signal breakdown · strategy feed · lead–lag panel
(Y-axis ±1, null-safe tooltip) · A/B toggle · honest empty states · terminal error state.

### Scripts
`cache_sessions.py` · `fetch_radio.py` · `fit_fusion.py` · `warm_models.py` · **`batch_analyse.py`** (new)

---

## 4. Plan edges — current state

| Edge | Built? | Working? | Blocker |
|---|---|---|---|
| **1. Lead–lag insight** | ✅ | ❌ no data | Run `batch_analyse.py` |
| **2. A/B toggle** | ✅ | ⚠️ partial | Labels → `fit_fusion.py` makes the difference visible |
| **3. Per-driver calibration** | ✅ | ❌ population priors | Calm-labelled clips per driver |
| **4. Strategy layer** | ✅ | ⚠️ | Fires on whatever stress readings exist |

All four switch on from the same input: **labelled clips + batch_analyse run**.

---

## 5. Bugs fixed (cumulative)

The first 6 were in the initial build. The new ones were found and fixed on 12 Aug.

| # | Bug | Impact | Fix |
|---|---|---|---|
| 1 | FastF1 fuzzy-matched "Interlagos" → Dutch GP | Cached Zandvoort twice | Refused fuzzy matches |
| 2 | Silero VAD returned 0% speech | Needed 576-sample windows, was fed 512 | WINDOW = HOP + CONTEXT = 576 |
| 3 | Failed pitch tracking → strong fatigue signal | f0=0 z-scored to −3.57 | Absent features score neutral (0.0) |
| 4 | Pause ratio measured after pauses removed | ~0 by construction for every clip | Taken from VAD ratio on original clip |
| 5 | São Paulo URL crashed on non-ASCII | Lost 87 clips | Percent-encoding |
| 6 | Session slug mangled São Paulo | NFKD-normalised | Fixed |
| 7 | **GP_USE_FIXTURES defaulted to 1** | Upload returned fake Hamilton transcript for any clip | Default → 0; upload path never uses fixtures |
| 8 | **Clip audio_url assumed .wav** | All .mp3 uploads 404'd in the player | Extension-aware glob lookup |
| 9 | **MoodResult.fitted defaulted to True** | Untrained head claimed to be trained | Default → False (fail-closed) |
| 10 | **Binary sklearn classifier handled wrong** | 100% confidence on wrong class when only 2 labels present | Binary sigmoid path added |
| 11 | **baseline.build imputed 0.0 for missing features** | Standing Tired-bias in driver baselines | Skip absent features, fall back to population prior |
| 12 | **Lead-lag coerced unmeasured lags to 0.0** | Headline claim manufactured from missing data | None for < 4 pairs; peak only over measured lags |
| 13 | **fit_fusion.py ran prosody on full audio** | Train/serve distribution mismatch for pause_ratio | VAD applied before prosody in training, matching inference |
| 14 | **pd.NA lap number not guarded** | Bare 500 on /api/timeline, frozen "Loading session…" | Skip NA rows |
| 15 | **warm() never called at startup** | First upload paid model-load + audio JIT (~50s total) | FastAPI lifespan + _warm_audio_stack() |
| 16 | **No clip browser UI** | PS1 "play" deliverable unreachable | /api/clips/library + ClipBrowser component |

---

## 6. What is left — prioritised

### BLOCKING — must happen before 15 Aug

| Task | Who | Effort | Why |
|---|---|---|---|
| **Create HF accounts** | **Everyone** | 10 min | Rule 03a. Zero code. Zero excuse. |
| **Label 80–100 clips** | B + C (2 labellers) | 2–3 hrs | Unlocks all four edges in one step |
| **Run `batch_analyse.py`** | A | ~1.5 hrs (overnight) | Populates timeline, lead-lag, strategy |
| **Run `fit_fusion.py`** | A | 5 min (after labels) | Fits real fusion head, produces the accuracy slide |

### HIGH VALUE

| Task | Who | Effort | Why |
|---|---|---|---|
| **Swap distil-whisper** | A | 30 min | 33s/clip → ~10s/clip. Critical for live upload demo |
| **WebSocket progress UI** | D | 1 hr | Proves inference is live, not a fixture replay |
| **Publish HF dataset** | C | 1 hr | Rule 03 goes from "we used models" to "we gave one back" |
| **Deploy HF Space** | C | 1 hr | Rule 03 second artifact; public URL for demo |
| **"Ask the Pit Wall" agent** | D | 3 hrs | Strong differentiator for offline round |
| **2-min demo video** | A | 1 hr | Required for submission |

### LOWER PRIORITY

| Task | Effort | Notes |
|---|---|---|
| Basic pytest suite | 2 hrs | 10 cases over pure functions; no models needed |
| Denoising (speechbrain) | 1 hr | Optional; nice before/after slide if it works |
| README architecture diagram | 30 min | Polish |

---

## 7. Team structure — 4 independent branches

Each branch touches non-overlapping files. They merge into main in the order listed.

### Person A — `feature/speed-and-inference`
**Owner:** Shreevats (repo admin)
**Files:** `backend/app/config.py` (STT swap) · runs scripts, commits results

| Task | Detail |
|---|---|
| Swap STT to distil-whisper | Change `STT_MODEL` default in config.py; verify word timestamps still work |
| Run `batch_analyse.py` (overnight) | `python scripts/batch_analyse.py --session 2023-dutch-r` then all sessions |
| After labelling lands: run `fit_fusion.py` | Produces `data/labels/fusion_head.json` + `driver_baselines.json` |
| Commit the two JSON files | These are committed on purpose (see SETUP.md) |
| Record 2-min demo video | Follow the script in PLAN.md §10 |

**HF:** Create account → become admin of org `silent-co-driver` (or use personal space)

---

### Person B — `feature/labels-and-fit`
**Files:** `data/clips/index.csv` only (no Python changes)

| Task | Detail |
|---|---|
| Label ~45 clips | Dutch GP priority: ALO (16 clips), VER (15), HUL (14). Hunt Tired: last stints, post-incident. Values: `Calm` / `Stressed` / `Tired` |
| Labelling guide | Each clip: listen once, pick the dominant state for the *driver* (not engineer), skip if unsure |
| Skew target | ~40% Calm · 40% Stressed · 20% Tired |
| Commit the labelled CSV | Branch `feature/labels-and-fit` |
| Cross-check 10 clips with Person C | Report agreement rate in commit message |

**HF:** Create personal account → join org `silent-co-driver`

---

### Person C — `feature/hf-deployment`
**Files:** `Dockerfile` (new) · `README.md` (minor) · HF dataset card files

| Task | Detail |
|---|---|
| Label ~45 clips | São Paulo + Singapore sessions. Same guide as Person B. Different clips, no overlap except the 10 agreement-check clips. |
| Cross-check 10 clips with Person B | Compute Cohen's κ — report it on the slide |
| Create HF org `silent-co-driver` | Add all team members |
| Publish dataset | Upload `data/clips/index.csv` (labelled) to Hub as `silent-co-driver/f1-team-radio-stress` with a dataset card |
| Write Dockerfile | FastAPI + pre-downloaded models. Target: `docker run -p 8000:8000 silent-co-driver` works |
| Deploy HF Space | Space type: Docker. Exposes the full API. |

**HF:** Create personal account → create org → publish dataset → deploy Space

---

### Person D — `feature/ws-agent`
**Files:** `frontend/src/components/RadioInspector.tsx` · `frontend/src/api.ts` · `backend/app/routers/agent.py` (new) · `backend/tests/test_pipeline.py` (new) · `backend/app/main.py` (add router)

| Task | Detail |
|---|---|
| WebSocket progress UI | Consume `WS /api/analyse/ws` in RadioInspector. Show stage names as they arrive (preprocess → VAD → STT → prosody → acoustic → text → fusion). One line per stage with a tick when done. This replaces the silent "Analysing…" 13-second wait. |
| "Ask the Pit Wall" agent | Tool-calling loop over the 7 tools listed in PLAN.md §6. Feature-flagged (`GP_AGENT=1`). Claude API or any provider. ~150 lines. Kill criterion: if not solid by 22 Aug morning, the flag stays off. |
| Basic tests | `backend/tests/test_pipeline.py` — 10 pytest cases over pure functions: `_pearson`, `z_scores`, `naive`, `_rule_based`, `_softmax`, `median_stint_length`. No models needed. |
| Wire agent router | Add `from app.routers import agent` + `app.include_router(agent.router)` to main.py — only if `GP_AGENT=1` |

**HF:** Create personal account → join org `silent-co-driver`

---

## 8. Merge order and integration plan

```
main (current: 5e762f3)
 ├── feature/labels-and-fit          (B) → merge first: index.csv labels
 ├── feature/speed-and-inference     (A) → merge second: depends on labels for fit_fusion
 ├── feature/ws-agent                (D) → merge third: pure frontend + new backend file
 └── feature/hf-deployment          (C) → merge last: Dockerfile + dataset (no code conflicts)
```

Each PR should:
1. `git pull origin main` before raising
2. Only touch the files listed above
3. Have a commit message from `shreevatsdhyani <shreevats37@gmail.com>` (or team member's own account — but keep the repo owner consistent for the HF rule)

---

## 9. Honest risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **No labels by 14 Aug** | **Critical** | B and C start labelling today. 45 clips each = 2 hrs. |
| **HF accounts missing** | **Critical** | Today. 10 minutes. |
| **33s/clip too slow for live demo** | High | distil-whisper (A) + precomputed cache (batch_analyse) |
| **data/results/ still empty at demo** | High | batch_analyse.py overnight tonight |
| **Agreement rate too low** | Medium | B+C cross-check 10 clips first; re-calibrate before labelling the rest |
| **Venue wifi fails 22 Aug** | Medium | `offline_ready: true`, rehearse in airplane mode |
| **Agent layer not ready** | Low | Feature flag — if off, nobody sees it |

---

## 10. What we should NOT claim yet

- ❌ "X% accurate" — nothing measured yet
- ❌ "Calibrated per driver" — population priors until Calm labels exist
- ❌ "Stress predicts pace loss by N laps" — lead-lag has no data yet
- ✅ "Four Hub models, 446 real clips, five real Grands Prix, runs fully offline" — all verifiable now
- ✅ "Both inference paths (naive/fusion) run; the difference is visible" — after labels land

The UI enforces this: `MoodResult.fitted=False` and `DriverBaseline.source='prior'`
are surfaced — the dashboard cannot overclaim what the backend hasn't earned.

---

## 11. Recommended timeline to 15 Aug

| When | Who | Task |
|---|---|---|
| **Today (12 Aug)** | All | Create HF accounts. Start on respective branches. |
| **12 Aug evening** | A | Start `batch_analyse.py --session 2023-dutch-r` (leave overnight) |
| **12 Aug evening** | B+C | Label 45 clips each. Commit CSV to their branches. |
| **13 Aug morning** | A | Merge B+C label branches → run `fit_fusion.py` → commit JSON |
| **13 Aug** | A | distil-whisper swap. Verify word timestamps. |
| **13 Aug** | D | WebSocket UI merged. Agent layer started. |
| **13 Aug** | C | HF dataset published. Space started. |
| **14 Aug** | All | Dry run with wifi off. Fix what breaks. |
| **14 Aug** | A | Record 2-min demo video following PLAN.md §10 script |
| **15 Aug** | All | Submit early. **Do not start anything new.** |
