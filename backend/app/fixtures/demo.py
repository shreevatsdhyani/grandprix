"""Synthetic fixture data for frontend development.

THIS IS NOT REAL DATA. It exists so the frontend can be built against the exact
shapes in `schemas.py` on D1, while the pipeline is still being written, and so
layout work is never blocked on model downloads.

Every response built here is marked `synthetic: true` at the API boundary, and
`GP_USE_FIXTURES=0` disables it entirely. Nothing from this module may appear in
the demo on 22 Aug — the DoD checklist requires real FastF1 data on screen.

The numbers are shaped to look plausible (a driver fading in the final stint)
so that chart axes, colour scales and empty states get exercised realistically.
"""

from __future__ import annotations

import math

from app.schemas import (
    AcousticSignal,
    ClipAnalysis,
    DriverBaseline,
    LeadLagAnalysis,
    LeadLagPoint,
    Mood,
    MoodResult,
    ProsodySignal,
    ScoringMode,
    SessionMeta,
    SignalBreakdown,
    StrategyCall,
    TextSignal,
    Timeline,
    TimelinePoint,
    Transcript,
    Urgency,
    Word,
)

DEMO_SESSION = SessionMeta(
    session_id="2024-silverstone-r",
    year=2024,
    event_name="British Grand Prix",
    session_type="R",
    drivers=["HAM", "VER", "NOR", "RUS", "LEC", "SAI"],
    cached=True,
)

TOTAL_LAPS = 52

# Radio moments: (lap, mood, transcript, stress). Scripted so the fixture tells
# the same story the real demo will: calm early, venting mid-race with no pace
# loss (the HOLD case), genuine fatigue late.
_RADIO = [
    (8, Mood.CALM, "Copy that, balance feels good. Fronts are working.", 22.0),
    (19, Mood.CALM, "Tell me the gap to Norris.", 28.0),
    (27, Mood.STRESSED, "He pushed me wide! That's not fair, come on.", 74.0),
    (34, Mood.STRESSED, "I'm losing the rears every corner now.", 68.0),
    (41, Mood.TIRED, "I've got nothing left in the rears. Nothing.", 81.0),
    (44, Mood.TIRED, "How many laps? I can't keep this up much longer.", 86.0),
    (48, Mood.TIRED, "Just tell me the gap. Please.", 79.0),
]


def _pace_delta(lap: int) -> float:
    """Plausible pace curve: settled mid-race, degrading from ~lap 38."""
    base = 0.45 * math.exp(-lap / 6)  # early tyre warm-up
    if lap >= 38:
        base += 0.055 * (lap - 38)  # the fade the voice predicted
    if lap in (23, 24):
        base += 1.9  # pit stop in/out laps
    wobble = 0.06 * math.sin(lap * 2.1)
    return round(base + wobble, 3)


def _is_clean(lap: int) -> bool:
    return lap not in (23, 24)  # in-lap / out-lap


def _clip(lap: int, mood: Mood, text: str, stress: float) -> ClipAnalysis:
    words = text.split()
    per_word = 0.42
    stamped = [
        Word(text=w, start=round(i * per_word, 2), end=round((i + 1) * per_word, 2))
        for i, w in enumerate(words)
    ]

    # The naive path is deliberately degraded in the same way the real one is:
    # an emotion model with no fatigue class cannot return TIRED, so it reaches
    # for its nearest neighbour and reports low confidence.
    if mood is Mood.TIRED:
        naive_mood, naive_conf, naive_stress = Mood.CALM, 0.41, stress * 0.45
        ser_top, ser_probs = "sad", {"sad": 0.44, "neu": 0.33, "ang": 0.14, "hap": 0.09}
    elif mood is Mood.STRESSED:
        naive_mood, naive_conf, naive_stress = Mood.STRESSED, 0.72, stress * 0.92
        ser_top, ser_probs = "ang", {"ang": 0.71, "neu": 0.16, "sad": 0.09, "hap": 0.04}
    else:
        naive_mood, naive_conf, naive_stress = Mood.CALM, 0.80, stress
        ser_top, ser_probs = "neu", {"neu": 0.79, "hap": 0.11, "sad": 0.06, "ang": 0.04}

    fatigue = mood is Mood.TIRED
    stressed = mood is Mood.STRESSED

    return ClipAnalysis(
        clip_id=f"demo-{lap:02d}",
        driver="HAM",
        session_id=DEMO_SESSION.session_id,
        lap=lap,
        duration_s=round(len(words) * per_word, 2),
        audio_url=f"/api/clips/demo-{lap:02d}.wav",
        transcript=Transcript(
            text=text, words=stamped, stt_model="openai/whisper-small (fixture)"
        ),
        signals=SignalBreakdown(
            prosody=ProsodySignal(
                score=round(stress * (1.12 if fatigue else 0.95), 1),
                f0_mean_z=round(-1.4 if fatigue else (1.6 if stressed else 0.1), 2),
                f0_std_z=round(-1.7 if fatigue else (1.3 if stressed else 0.0), 2),
                rms_mean_z=round(-1.5 if fatigue else (1.4 if stressed else 0.1), 2),
                speech_rate_z=round(-1.6 if fatigue else (0.9 if stressed else 0.0), 2),
                pause_ratio_z=round(1.8 if fatigue else (-0.4 if stressed else 0.0), 2),
                jitter_z=round(1.3 if fatigue else 0.4, 2),
            ),
            acoustic=AcousticSignal(
                score=round(naive_stress, 1),
                probabilities=ser_probs,
                top_label=ser_top,
                model_id="superb/wav2vec2-base-superb-er (fixture)",
            ),
            text=TextSignal(
                score=round(stress * (1.05 if fatigue else 0.9), 1),
                probabilities=(
                    {"sadness": 0.51, "fear": 0.22, "neutral": 0.17, "anger": 0.10}
                    if fatigue
                    else {"anger": 0.62, "neutral": 0.21, "sadness": 0.11, "joy": 0.06}
                    if stressed
                    else {"neutral": 0.74, "joy": 0.13, "sadness": 0.08, "anger": 0.05}
                ),
                top_label="sadness" if fatigue else "anger" if stressed else "neutral",
                model_id="j-hartmann/emotion-english-distilroberta-base (fixture)",
            ),
        ),
        fusion=MoodResult(
            mood=mood,
            confidence=0.78 if fatigue else 0.83,
            stress_index=stress,
            probabilities=(
                {Mood.CALM: 0.08, Mood.STRESSED: 0.14, Mood.TIRED: 0.78}
                if fatigue
                else {Mood.CALM: 0.11, Mood.STRESSED: 0.83, Mood.TIRED: 0.06}
                if stressed
                else {Mood.CALM: 0.86, Mood.STRESSED: 0.09, Mood.TIRED: 0.05}
            ),
            mode=ScoringMode.FUSION,
        ),
        naive=MoodResult(
            mood=naive_mood,
            confidence=naive_conf,
            stress_index=round(naive_stress, 1),
            probabilities=(
                {Mood.CALM: 0.41, Mood.STRESSED: 0.30, Mood.TIRED: 0.29}
                if fatigue
                else {Mood.CALM: 0.18, Mood.STRESSED: 0.72, Mood.TIRED: 0.10}
                if stressed
                else {Mood.CALM: 0.80, Mood.STRESSED: 0.14, Mood.TIRED: 0.06}
            ),
            mode=ScoringMode.NAIVE,
        ),
        processing_ms=0,
        cached=True,
    )


DEMO_CLIPS = [_clip(*r) for r in _RADIO]


DEMO_STRATEGY = [
    StrategyCall(
        lap=27,
        code="HOLD",
        headline="HOLD — driver venting, pace unaffected",
        rationale="Stress spike with no corresponding pace loss. Do not re-plan the stop.",
        urgency=Urgency.INFO,
    ),
    StrategyCall(
        lap=41,
        code="PIT_WINDOW_OPENING",
        headline="PIT WINDOW OPENING — fatigue ahead of tyre cliff",
        rationale="Fatigue markers sustained while stint length exceeds this driver's median.",
        urgency=Urgency.WARNING,
    ),
    StrategyCall(
        lap=44,
        code="BOX_NOW",
        headline="BOX THIS LAP — driver degradation confirmed",
        rationale="Stress elevated 3 consecutive laps and pace delta worsening 0.06s/lap.",
        urgency=Urgency.CRITICAL,
    ),
    StrategyCall(
        lap=45,
        code="REDUCE_RADIO_LOAD",
        headline="REDUCE RADIO LOAD — driver is saturated",
        rationale="Rising stress coinciding with elevated radio frequency.",
        urgency=Urgency.WARNING,
    ),
]


def _lead_lag() -> LeadLagAnalysis:
    """Peak at lag -2: the voice moves about two laps before the stopwatch."""
    curve = [
        LeadLagPoint(lag_laps=l, correlation=round(0.61 * math.exp(-((l + 2) ** 2) / 4.5), 3))
        for l in range(-4, 5)
    ]
    peak = max(curve, key=lambda p: p.correlation)
    n = len(DEMO_CLIPS)
    return LeadLagAnalysis(
        curve=curve,
        peak_lag_laps=peak.lag_laps,
        peak_correlation=peak.correlation,
        n_samples=n,
        interpretation=(
            f"Voice stress peaks about {abs(peak.lag_laps)} laps before pace loss "
            f"(r = {peak.correlation:.2f}). Indicative only — {n} clips in this session."
        ),
        is_significant=False,  # fixture sample is tiny, and the UI must say so
    )


def build_timeline(driver: str = "HAM", mode: ScoringMode = ScoringMode.FUSION) -> Timeline:
    by_lap = {c.lap: c for c in DEMO_CLIPS}
    points = []
    for lap in range(1, TOTAL_LAPS + 1):
        clip = by_lap.get(lap)
        result = clip.result_for(mode) if clip else None
        points.append(
            TimelinePoint(
                lap=lap,
                delta_s=_pace_delta(lap) if _is_clean(lap) else None,
                stress_index=result.stress_index if result else None,
                mood=result.mood if result else None,
                clip_id=clip.clip_id if clip else None,
            )
        )

    return Timeline(
        session=DEMO_SESSION,
        driver=driver,
        mode=mode,
        points=points,
        clips=DEMO_CLIPS,
        # The naive path produces no fatigue detections, so the strategy layer
        # has almost nothing to fire on. That contrast is the A/B toggle's point.
        strategy_calls=(
            DEMO_STRATEGY
            # `==` for the same reason as `Analysis.result_for` — identity here
            # reads a plain "fusion" as naive and silently serves the wrong half
            # of the A/B toggle.
            if mode == ScoringMode.FUSION
            else [c for c in DEMO_STRATEGY if c.code == "HOLD"]
        ),
        lead_lag=_lead_lag(),
        baseline=DriverBaseline(
            driver=driver,
            n_baseline_clips=4,
            f0_mean=142.3,
            rms_mean=0.061,
            speech_rate=3.1,
        ),
    )
