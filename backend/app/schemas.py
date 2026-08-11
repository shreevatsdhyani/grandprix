"""The API contract.

This module is the single source of truth for every payload crossing the
frontend/backend boundary. It is frozen early on purpose: the frontend builds
against these shapes using fixtures while the pipeline is still being written.

Change a field here and you have broken the frontend. Add fields freely.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# Core vocabulary
# --------------------------------------------------------------------------


class Mood(str, Enum):
    """The three classes the brief asks for. Exactly these words, no others.

    The brief's prose also mentions "frustrated"; it is deliberately not a class.
    Matching the spec vocabulary is worth more than extra granularity, and a
    fourth class would split our already-scarce TIRED training examples.
    """

    CALM = "Calm"
    STRESSED = "Stressed"
    TIRED = "Tired"


class ScoringMode(str, Enum):
    """Which scoring path produced a result.

    Exposed to the UI so the A/B toggle can show, live, the difference between a
    single off-the-shelf emotion model and our fusion head.
    """

    NAIVE = "naive"  # single acoustic SER model, argmax
    FUSION = "fusion"  # prosody + acoustic + text, per-driver calibrated


class Urgency(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# --------------------------------------------------------------------------
# Transcript
# --------------------------------------------------------------------------


class Word(BaseModel):
    """A single word with its timing, from Whisper's word-level timestamps.

    Timings drive the karaoke-style transcript highlight during playback, and
    feed the speech-rate prosody feature.
    """

    text: str
    start: float = Field(description="Seconds from clip start")
    end: float


class Transcript(BaseModel):
    text: str = Field(description="Full readable transcript. The brief's 'speech to text'.")
    words: list[Word] = []
    language: str = "en"
    stt_model: str = Field(description="HF model id used, shown in the UI provenance line")


# --------------------------------------------------------------------------
# The three signals feeding the fusion head
# --------------------------------------------------------------------------


class ProsodySignal(BaseModel):
    """Hand-engineered vocal-effort features.

    This is the branch that makes TIRED detectable at all: no off-the-shelf
    emotion model has a fatigue class, but fatigue is legible in pitch flatness,
    low energy and slowed articulation.

    Every value is z-scored against the driver's own green-flag baseline, so a
    naturally loud driver does not read as permanently stressed.
    """

    score: float = Field(ge=0, le=100, description="Contribution to stress index")
    f0_mean_z: float = Field(description="Pitch height vs this driver's baseline")
    f0_std_z: float = Field(description="Pitch variability; flat contour suggests fatigue")
    rms_mean_z: float = Field(description="Vocal energy")
    speech_rate_z: float = Field(description="Words/sec; slowed articulation suggests fatigue")
    pause_ratio_z: float = Field(description="Fraction of clip that is silence")
    jitter_z: float | None = Field(default=None, description="Cycle-to-cycle pitch perturbation")


class AcousticSignal(BaseModel):
    """Pretrained speech-emotion model output.

    Trained on IEMOCAP/RAVDESS-style corpora, so its native labels are emotions
    (angry/happy/sad/neutral/...), not our three classes. `probabilities` keeps
    the raw label space; `score` is its projection onto the stress axis.
    """

    score: float = Field(ge=0, le=100)
    probabilities: dict[str, float] = Field(description="Native label space of the SER model")
    top_label: str = Field(description="Raw model label, before mapping to our vocabulary")
    model_id: str


class TextSignal(BaseModel):
    """Emotion/intent read from the transcript rather than the audio.

    Catches content the acoustics miss: a calm-sounding driver saying
    "I've got nothing left" is reporting fatigue.
    """

    score: float = Field(ge=0, le=100)
    probabilities: dict[str, float] = {}
    top_label: str
    model_id: str


class SignalBreakdown(BaseModel):
    """The three bars in the UI. Explainability is a scoring criterion, so the
    contribution of each branch is always exposed, never hidden inside the score.
    """

    prosody: ProsodySignal
    acoustic: AcousticSignal
    text: TextSignal


# --------------------------------------------------------------------------
# Analysis result
# --------------------------------------------------------------------------


class MoodResult(BaseModel):
    mood: Mood
    confidence: float = Field(ge=0, le=1)
    stress_index: float = Field(ge=0, le=100, description="Continuous severity, drives the chart")
    probabilities: dict[Mood, float]
    mode: ScoringMode
    fitted: bool = Field(
        default=True,
        description=(
            "False when the fusion head has not been trained on annotations yet "
            "and the interpretable fallback produced this result. Surfaced in the "
            "UI so we never imply a trained model where there isn't one."
        ),
    )


class ClipAnalysis(BaseModel):
    """Everything known about one radio clip. The Radio Inspector panel renders this."""

    clip_id: str
    driver: str = Field(description="Three-letter driver code, e.g. VER")
    session_id: str
    lap: int | None = Field(default=None, description="Lap this clip was transmitted on")
    duration_s: float
    audio_url: str = Field(description="Served back for the in-browser player")

    transcript: Transcript
    signals: SignalBreakdown

    # Both scoring paths are always computed so the A/B toggle is instant and
    # cannot fail mid-demo. Cost is negligible; the models already ran.
    fusion: MoodResult
    naive: MoodResult

    processing_ms: int = 0
    cached: bool = False

    def result_for(self, mode: ScoringMode) -> MoodResult:
        return self.fusion if mode is ScoringMode.FUSION else self.naive


# --------------------------------------------------------------------------
# Lap / session data (FastF1)
# --------------------------------------------------------------------------


class Lap(BaseModel):
    lap: int
    lap_time_s: float | None = Field(default=None, description="None for unset/deleted laps")
    delta_s: float | None = Field(
        default=None,
        description=(
            "Lap time minus a rolling median of the driver's own clean laps. "
            "Raw lap time is dominated by fuel burn and traffic, so the delta is "
            "the only honest pace signal."
        ),
    )
    compound: str | None = None
    tyre_life: int | None = None
    stint: int | None = None
    is_clean: bool = Field(
        default=True,
        description=(
            "False for in-laps, out-laps and any lap under SC/VSC/yellow. "
            "Excluded from baselines and from the correlation."
        ),
    )
    track_status: str | None = None


class SessionMeta(BaseModel):
    session_id: str = Field(description="e.g. 2024-silverstone-r")
    year: int
    event_name: str
    session_type: str = Field(description="R, Q, FP1 ...")
    drivers: list[str]
    cached: bool = True


# --------------------------------------------------------------------------
# Strategy layer — the theme is "Racing Strategy & Decision-Making"
# --------------------------------------------------------------------------


class StrategyCall(BaseModel):
    """A decision, not an observation.

    The brief's theme is strategy and decision-making, so no screen ends at a
    mood label. Deterministic thresholds, not an LLM: the pit wall needs the
    same input to produce the same call every time.
    """

    lap: int
    code: Literal[
        "BOX_NOW",
        "PIT_WINDOW_OPENING",
        "HOLD",
        "REDUCE_RADIO_LOAD",
        "MONITOR",
    ]
    headline: str = Field(description="Engineer-language instruction, shown verbatim in the UI")
    rationale: str = Field(description="Why this fired, in one sentence")
    urgency: Urgency


# --------------------------------------------------------------------------
# The relationship the brief actually asks for
# --------------------------------------------------------------------------


class LeadLagPoint(BaseModel):
    lag_laps: int = Field(description="Negative means stress precedes the pace drop")
    correlation: float


class LeadLagAnalysis(BaseModel):
    """The brief asks for a visual showing whether mood is *affecting* lap
    performance — a relationship, not two charts side by side. This is that.

    Cross-correlates the stress series against the pace-delta series at a range
    of lags. A negative peak lag means the voice moved first.
    """

    curve: list[LeadLagPoint]
    peak_lag_laps: int
    peak_correlation: float
    n_samples: int = Field(description="Radio clips backing this; keeps the claim honest")
    interpretation: str = Field(description="Plain-language summary shown under the chart")
    is_significant: bool = Field(
        description="False when n is too small; the UI must then hedge the wording"
    )


# --------------------------------------------------------------------------
# The composed timeline — the hero chart
# --------------------------------------------------------------------------


class TimelinePoint(BaseModel):
    lap: int
    delta_s: float | None = None
    stress_index: float | None = Field(default=None, description="None on laps with no radio")
    mood: Mood | None = None
    clip_id: str | None = None


class DriverBaseline(BaseModel):
    """Surfaced in the UI so per-driver calibration is visible, not just claimed."""

    driver: str
    n_baseline_clips: int
    f0_mean: float
    rms_mean: float
    speech_rate: float
    source: Literal["driver", "cohort", "prior"] = Field(
        default="prior",
        description=(
            "Which reference the z-scores came from. 'prior' means population "
            "defaults — no annotations exist yet, so the UI must not claim this "
            "driver has been individually calibrated."
        ),
    )


class Timeline(BaseModel):
    session: SessionMeta
    driver: str
    mode: ScoringMode
    points: list[TimelinePoint]
    clips: list[ClipAnalysis]
    strategy_calls: list[StrategyCall]
    lead_lag: LeadLagAnalysis | None = None
    baseline: DriverBaseline | None = None


# --------------------------------------------------------------------------
# Progress streaming
# --------------------------------------------------------------------------


class PipelineStage(str, Enum):
    RECEIVED = "received"
    PREPROCESS = "preprocess"
    VAD = "vad"
    STT = "stt"
    PROSODY = "prosody"
    ACOUSTIC = "acoustic"
    TEXT = "text"
    FUSION = "fusion"
    ALIGN = "align"
    DONE = "done"
    ERROR = "error"


class ProgressEvent(BaseModel):
    """Streamed over WebSocket while a clip is analysed.

    Visible stage-by-stage progress is what proves to a judge that inference is
    genuinely running rather than being replayed from a fixture.
    """

    clip_id: str
    stage: PipelineStage
    message: str
    elapsed_ms: int = 0
    detail: dict[str, float | str | int] = {}


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    models_loaded: dict[str, bool]
    offline_ready: bool = Field(
        description="True when weights and session cache are on local disk. "
        "The GrandPrix venue is offline; this must be True on demo day."
    )
