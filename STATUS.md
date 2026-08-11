# STATUS — The Silent Co-Driver

**As of 11 Aug 2026.** Online round **15 Aug (4 days)** · GrandPrix offline **22 Aug (11 days)**

Tracked against three sources of truth:
`PLAN.md` (our agreed plan) · `Grandprix Problem Statements.docx` (the brief) · `luma.pdf` (the rules deck)

---

## 1. One-line status

The product works end to end on real data — five real Grands Prix, 446 real team-radio
clips, four Hugging Face models, a live pipeline and a working dashboard.
**What it cannot yet do is claim accuracy**, because nothing is labelled, so the fusion
head is untrained and scoring runs on population priors.

Roughly **75% built, 0% validated.** The remaining 25% is mostly not code.

---

## 2. Brief compliance — the rules that decide eligibility

From the docx "General Rules: Mandatory for All Teams".

| # | Rule | Status | Evidence |
|---|---|---|---|
| 01 | Frontend **and** backend, both. No notebook-only. | ✅ **Met** | React/Vite dashboard ↔ FastAPI, 8 endpoints, live over HTTP |
| 02 | Balanced difficulty — not one ready-made call, not from scratch | ✅ **Met** | 4 pretrained Hub models + 8 engineered prosody features + our own fusion head. Nothing trained from scratch. |
| 03a | Every team member has their own HF account | ❌ **NOT DONE — blocking** | No accounts created. Downloads were anonymous (no token needed for public models). |
| 03b | Solution uses something from the Hub | ✅ **Met** | 4 models, 2.3 GB cached locally |
| — | One problem statement per team | ✅ | PS1 only |

> **03a is the only rule we currently fail.** It costs nothing and takes ten minutes.
> Everyone on the team should create an account today.

### Theme alignment
Brief theme: *"Artificial Intelligence in Racing Strategy & Decision-Making."*
✅ The strategy layer (`app/pipeline/strategy.py`) converts every stress reading into an
engineer instruction — `BOX_NOW`, `PIT_WINDOW_OPENING`, `HOLD`, `REDUCE_RADIO_LOAD`.
No screen ends at a mood label.

### The brief's five named deliverables
| Spec wording | Status |
|---|---|
| "play or upload a radio audio clip" | ✅ upload button always visible; audio served from `/api/clips/{id}` |
| "converts the speech to text" | ✅ Whisper, with word-level timestamps |
| "shows if the driver seems calm, stressed, or tired" | ⚠️ **works, but unvalidated** — exact 3-class vocabulary, untrained head |
| "alongside basic lap-time information" | ✅ real FastF1 pace deltas |
| "visual showing if mood is **affecting** lap performance" | ⚠️ lead–lag panel **built**, has no data to run on yet |

---

## 3. What is done

### Data layer — real, cached, offline
| Item | Detail |
|---|---|
| Races | 5 real sessions, 553 MB cached to disk |
| Laps | 5,598 across all sessions |
| Pace delta | vs rolling median of *clean* laps; excludes in/out laps, SC/VSC/yellow, deleted laps |
| Radio clips | **446**, auto-downloaded and lap-mapped |
| Offline | `offline_ready: true` — runs with wifi off |

Clips per race: Dutch 172 · São Paulo 87 · Singapore 77 · Italian 65 · British 45

### Hugging Face models (Rule 03)
| Role | Model | Size |
|---|---|---|
| Speech-to-text | `openai/whisper-small` | 927 MB |
| Acoustic emotion | `superb/wav2vec2-base-superb-er` | 722 MB |
| Text emotion | `j-hartmann/emotion-english-distilroberta-base` | 630 MB |
| Voice activity detection | `istupakov/silero-vad-onnx` | 3.5 MB |

VAD substitutes for the plan's `pyannote/segmentation-3.0`, which is **gated** —
it needs an account, an accepted licence and a token. The plan named Silero as the
ungated fallback for exactly this reason.

### Pipeline — 11 modules, ~1,000 lines
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

### Frontend — 1,100 lines
Race + driver pickers, dual-panel timeline, radio inspector, signal breakdown,
strategy feed, lead–lag panel, A/B toggle, honest empty states.

### Tooling
`cache_sessions.py` · `fetch_radio.py` · `fit_fusion.py` · `warm_models.py` · `dev.sh`

---

## 4. Plan edges — are we still on the pathway?

The three (later four) differentiators from `PLAN.md` §7:

| Edge | Built? | Working? | Note |
|---|---|---|---|
| **1. Lead–lag insight** | ✅ code complete | ❌ **no data** | Needs labelled clips analysed against laps |
| **2. A/B toggle (naive ⇄ fusion)** | ✅ | ⚠️ partial | Both paths run; the *difference* is not yet meaningful without a trained head |
| **3. Per-driver calibration** | ✅ code complete | ❌ **using population priors** | Needs Calm-labelled clips per driver |
| **4. Strategy layer** | ✅ | ⚠️ | Fires correctly, but only on stress readings that don't exist yet |

**All four edges are built and all four are dormant.** Every one of them switches on
from the same input: labelled clips. That is the single highest-leverage task remaining.

---

## 5. What is left

### Blocking — only the team can do this
| Task | Effort | Why it matters |
|---|---|---|
| **Create HF accounts (everyone)** | 10 min | Rule 03a. The only rule we currently fail. |
| **Label 80–100 clips** | 2–3 hrs | Unlocks all four edges. Two annotators, keep agreements, report the rate. |

Then one command — `python scripts/fit_fusion.py` — fits per-driver baselines and the
fusion head and prints cross-validated accuracy vs the naive baseline. **That number is
the slide.**

Skew the labelling ~40% Calm / 40% Stressed / **20% Tired** — Tired is rarest and most
valuable. Hunt end-of-race, high-heat and post-incident radio.

### High value, I can do
| Task | Effort | Why |
|---|---|---|
| **Swap in `distil-whisper`** | 30 min | **13 s/clip is too slow to upload live on stage.** Target ~4 s. |
| **Publish HF dataset + Space** | 2 hrs | Turns Rule 03 from "we used models" into "we gave two artifacts back". Needs a write token. |
| **Batch-analyse all clips** | 1 hr | Pre-populates the result cache so the demo timeline is instant and cannot fail. |
| **WebSocket progress UI** | 1 hr | Backend streams stages already; the UI doesn't consume it. Proves inference is live. |

### Lower priority
- "Ask the Pit Wall" agent layer — plan says build last, behind a feature flag
- Denoising (`speechbrain/metricgan-plus-voicebank`) — optional in plan
- Automated tests — none exist

---

## 6. Deviations from PLAN.md

| Plan said | We did | Verdict |
|---|---|---|
| Curate 60–100 clips manually from broadcast | Auto-downloaded 446 via F1 live-timing manifest | **Better.** Plan §5.3 budgeted days; this is one command. Labelling is still manual, as planned. |
| Dual-axis hero chart | Two panels, shared lap axis | **Better.** Two y-scales manufacture correlation — fatal when correlation is the headline claim. |
| `pyannote/segmentation-3.0` for VAD | `istupakov/silero-vad-onnx` | **Equivalent.** Primary was gated; plan named this fallback. |
| Whisper-small | Whisper-small | On plan, but too slow — see above |
| Publish dataset + Space to Hub | Not done | **Behind** |
| Agent layer | Not done | On schedule (plan says last) |

**No unplanned scope was added.** Everything built maps to a PLAN.md line item.

---

## 7. Bugs found and fixed

Worth keeping — several were silent, and the pattern matters.

1. **FastF1 fuzzy-matched "Interlagos" → Dutch GP.** Cached Zandvoort twice; we had 4 races believing we had 5. Would have halved the sample and inflated the correlation. Now refuses fuzzy matches.
2. **Silero VAD returned 0% speech on everything.** Needs 576-sample windows (512 + 64 context); a bare 512 runs without error and reports silence. Silent wrong answer.
3. **Failed pitch tracking read as extreme fatigue.** `f0_mean = 0` z-scored to −3.57, the strongest "tired" signal in the set — so the noisiest clips were automatically the most exhausted. Unmeasurable features now score neutral.
4. **Pause ratio measured after pauses were removed.** ~0 by construction, biasing every driver identically. Now taken from the VAD ratio on the original clip.
5. **`São Paulo` URL crashed on non-ASCII.** Cost 87 clips, reported only as "manifest unavailable". Fixed with percent-encoding.
6. **Session slug mangled `São Paulo` → `so-paulo`.** ASCII encode deletes `ã`; now NFKD-normalised.

---

## 8. Honest risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **No labels → no accuracy claim** | **Critical** | Label this week. Everything else is ready. |
| **HF accounts missing** | **Critical** | 10 minutes. Rule 03a is checked. |
| 13 s/clip live inference | High | distil-whisper + precomputed cache |
| Classification quality unknown on real radio | High | Unmeasurable until labels exist |
| Whisper garbles noisy radio | Medium | Improved a lot with VAD; acknowledge on a slide |
| Venue wifi fails 22 Aug | Medium | Already handled — `offline_ready: true`, rehearse in airplane mode |
| Nothing published back to Hub | Medium | 2 hrs work |

---

## 9. What we should NOT claim yet

Discipline here is worth more than the features:

- ❌ "Our model is X% accurate" — nothing has been measured
- ❌ "Calibrated per driver" — currently population priors; the UI says so
- ❌ "Stress predicts pace loss by N laps" — no data behind the correlation yet
- ✅ "Four Hub models, real F1 data, 446 real clips, runs fully offline" — all verifiable now

The UI already enforces this: `MoodResult.fitted` and `DriverBaseline.source` are
surfaced so the interface cannot overclaim what the backend hasn't earned.

---

## 10. Recommended order for the next 4 days

**Today (11 Aug)** — HF accounts for everyone (10 min). Start labelling. I swap in distil-whisper.
**12 Aug** — Finish labelling to ~100. Run `fit_fusion.py`. First real accuracy number.
**13 Aug** — Batch-analyse all clips. All four edges light up. Publish dataset + Space.
**14 Aug** — Polish, WebSocket progress, README, record demo video.
**15 Aug** — Submit early. Build nothing new.
