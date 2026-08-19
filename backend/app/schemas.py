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
        # Defaults to False so that claiming a trained model is something a
        # caller has to do on purpose. The default used to be True, which meant
        # the demo fixtures — which never set this field — silently asserted a
        # fitted head, suppressing the very UI banner that exists to admit there
        # isn't one. An honesty flag must fail closed.
        default=False,
        description=(
            "True only when a fusion head fitted on our own annotations produced "
            "this result. False for the interpretable fallback. Surfaced in the "
            "UI so we never imply a trained model where there isn't one."
        ),
    )


class ClipSummary(BaseModel):
    """One row in the clip library the user picks from.

    The brief's first deliverable is "play *or* upload a radio clip". Upload was
    built; play had no list endpoint and no UI, so the 446 curated clips on disk
    were unreachable. This is what makes them browsable without paying for
    inference on all of them up front.
    """

    clip_id: str
    session_id: str
    driver: str
    lap: int | None = None
    audio_url: str
    label: str | None = Field(default=None, description="Hand annotation, if any")
    analysed: bool = Field(
        default=False,
        description="True when a cached analysis exists, so the UI can show it instantly",
    )
    mood: Mood | None = Field(default=None, description="From the cached analysis, if present")
    stress_index: float | None = None


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
    correlation: float | None = Field(
        default=None,
        description=(
            "None when too few clip/lap pairs exist at this offset to compute r. "
            "Deliberately not 0.0: an unmeasured lag reported as zero is "
            "indistinguishable from a measured absence of correlation, and the "
            "peak-picker would then select it."
        ),
    )
    n_pairs: int = Field(default=0, description="Clip/lap pairs behind this coefficient")


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

    # Race context, attached per lap so the hero chart can draw compound bands
    # and rain overlays without a second round trip. All optional: a session with
    # no context built yet renders exactly as it did before.
    track: TrackConditions | None = None
    tyre: TyreState | None = None
    situation: RaceSituation | None = None


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

    # None when scripts/build_context.py has not been run for this session. The
    # frontend degrades to the pre-context view rather than erroring.
    session_context: SessionContext | None = None
    clip_contexts: dict[str, ClipContext] = Field(
        default={}, description="Per-clip fused context, keyed by clip_id"
    )
    biometrics: BiometricSeries | None = None


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


class ModelCard(BaseModel):
    n_train: int = Field(description="Labelled clips the head was fitted on")
    cv_accuracy: float = Field(
        ge=0, le=1, description="Cross-validated accuracy of the fusion head"
    )
    naive_accuracy: float = Field(
        ge=0,
        le=1,
        description=(
            "Same labels, single acoustic SER model — the baseline fusion is "
            "measured against."
        ),
    )
    features: list[str] = Field(
        description="Feature vector, in the positional order coefficients are stored in"
    )


# --------------------------------------------------------------------------
# Race context — what was true at a given instant
#
# The voice pipeline answers "how did the driver sound". These models answer
# "and what was happening to them at that moment": the track, the tyres, where
# on the lap they were, and what the race was doing around them.
#
# Every one of these is resolved from a single UTC instant, which is what makes
# the same code work for a cached race and (later) a live one.
# --------------------------------------------------------------------------


class TrackConditions(BaseModel):
    """Weather and grip at one moment.

    `grip_proxy_s` is the field's median lap time on that lap. It is not a
    measurement of grip — it is the best available proxy, and it moves with
    rubber-in, rain, and safety cars alike, so it must be read alongside
    `rainfall` and the flags rather than on its own.
    """

    air_temp_c: float | None = None
    track_temp_c: float | None = None
    rainfall: bool | None = Field(
        default=None, description="F1's binary wet/dry sensor, not a rate"
    )
    humidity_pct: float | None = None
    pressure_hpa: float | None = None
    wind_speed_ms: float | None = None
    wind_direction_deg: int | None = None
    track_temp_delta_from_start_c: float | None = Field(
        default=None,
        description=(
            "Track temperature now minus at session start. A large negative "
            "value means the surface is cooling, which costs front grip and "
            "shows up as understeer complaints on the radio."
        ),
    )
    grip_proxy_s: float | None = Field(
        default=None, description="Field median lap time on this lap; a proxy, not a measurement"
    )
    is_wet: bool | None = None


class TyreState(BaseModel):
    """Modelled tyre condition.

    IMPORTANT: real tyre temperature, pressure and wear percentage are not
    publicly available for any session — teams hold that data privately. Nothing
    here is measured off the tyre. Everything is inferred from compound, age and
    how the driver's lap times are trending within the stint.

    `basis` is a constant rather than a flag so it cannot be forgotten: any
    consumer rendering this must be able to see, from the payload alone, that it
    is looking at a model output.
    """

    compound: str | None = None
    tyre_age_laps: int | None = None
    stint_number: int | None = None
    laps_into_stint: int | None = None
    deg_slope_s_per_lap: float | None = Field(
        default=None,
        description=(
            "Least-squares slope of lap time against tyre age within this "
            "stint. Positive means losing time per lap. None when the stint has "
            "too few timed laps to fit."
        ),
    )
    stint_vs_driver_median_laps: int | None = Field(
        default=None, description="Laps this stint is longer (+) or shorter (-) than the driver's median"
    )
    past_cliff: bool | None = Field(
        default=None,
        description="True when recent laps degrade materially faster than the stint's own trend",
    )
    basis: Literal["modelled"] = Field(
        default="modelled",
        description="Always 'modelled'. Real tyre sensor data is not publicly available.",
    )


class TrackPosition(BaseModel):
    """Where on the lap the car was, and what it was doing there.

    This is what turns "stress spiked on lap 41" into "stress spiked on the exit
    of Turn 18 at 260kph" — the difference between a chart and a debrief.
    """

    distance_into_lap_m: float | None = None
    lap_length_m: float | None = None
    pct_of_lap: float | None = None
    nearest_corner: int | None = Field(default=None, description="Turn number, from circuit geometry")
    distance_to_corner_m: float | None = Field(
        default=None, description="Signed: negative means the corner is behind the car"
    )
    sector: int | None = None
    speed_kph: float | None = None
    throttle_pct: float | None = None
    brake: bool | None = None
    gear: int | None = None
    rpm: int | None = None
    drs_active: bool | None = None
    zone: Literal["braking", "high_speed", "corner", "pit_lane", "other"] | None = None


class RaceControlEvent(BaseModel):
    utc: str
    lap: int | None = None
    category: str | None = None
    flag: str | None = None
    scope: str | None = None
    message: str
    offset_s: float = Field(
        description="Seconds relative to the moment being explained; negative means before"
    )


class RaceSituation(BaseModel):
    """The competitive picture — the thing a stress reading is usually about."""

    position: int | None = None
    gap_ahead_s: float | None = None
    gap_to_leader_s: float | None = None
    track_status: str | None = Field(
        default=None, description="FastF1 concatenated status digits for the lap"
    )
    active_flags: list[str] = []
    nearby_messages: list[RaceControlEvent] = []
    in_traffic: bool | None = None


# --------------------------------------------------------------------------
# Driver biometrics
#
# The stress signal in this app is derived from voice. Biometrics are a second,
# independent channel — and one we have no real data for yet. The ingestion path
# exists so real data can be dropped in; until then every field is absent rather
# than estimated, because a synthetic heart rate presented next to a real track
# temperature would be indistinguishable from a measurement.
# --------------------------------------------------------------------------


class BiometricSample(BaseModel):
    utc: str
    hr_bpm: float | None = None
    hrv_ms: float | None = Field(default=None, description="RMSSD or SDNN, whichever the source reports")
    core_temp_c: float | None = None


class BiometricPoint(BaseModel):
    """One biometric reading aligned to a moment, with per-driver calibration.

    Z-scores use the same convention as the prosody branch: a driver's own
    session baseline, so a naturally high-heart-rate driver does not read as
    permanently stressed.
    """

    utc: str
    lap: int | None = None
    hr_bpm: float | None = None
    hrv_ms: float | None = None
    core_temp_c: float | None = None
    hr_z: float | None = None
    hrv_z: float | None = None


class BiometricSeries(BaseModel):
    driver: str
    session_id: str
    source: str = Field(description="Where this came from, e.g. a filename or device name")
    n_samples: int
    samples: list[BiometricPoint] = []
    hr_baseline_bpm: float | None = None
    hr_baseline_sd: float | None = None
    coverage_note: str | None = Field(
        default=None, description="Plain-language caveat shown in the UI alongside any claim"
    )


# --------------------------------------------------------------------------
# The fused packet
# --------------------------------------------------------------------------


class ClipContext(BaseModel):
    """Everything that was true when one radio call was transmitted.

    Resolved from the clip's exact UTC timestamp, which comes from matching the
    F1 live-timing recording filename. That timestamp is also how clips with no
    lap number in the index get one.
    """

    clip_id: str
    utc: str
    lap: int | None = None
    phase: Literal["pre_race", "racing", "post_race"] | None = Field(
        default=None,
        description=(
            "Where in the session this call sits. Roughly a sixth of all radio "
            "traffic happens on the grid or after the flag, and it is a different "
            "kind of signal: grid nerves and a victory shout are not mid-race "
            "fatigue. Off-lap calls carry track conditions but no tyre or "
            "position data, because they had neither."
        ),
    )
    resolved_from: Literal["utc", "lap"] = Field(
        default="utc",
        description="'utc' is exact; 'lap' means we only knew the lap and used its midpoint",
    )
    track: TrackConditions | None = None
    tyre: TyreState | None = None
    position: TrackPosition | None = None
    situation: RaceSituation | None = None
    biometrics: BiometricPoint | None = None


class StintSummary(BaseModel):
    stint_number: int
    compound: str | None = None
    lap_start: int
    lap_end: int
    n_laps: int
    best_lap_s: float | None = None
    deg_slope_s_per_lap: float | None = None
    basis: Literal["modelled"] = "modelled"


class TrackEvolutionPoint(BaseModel):
    lap: int
    grip_proxy_s: float | None = None
    track_temp_c: float | None = None
    air_temp_c: float | None = None
    rainfall: bool | None = None


class SessionContext(BaseModel):
    """Session-wide context, built once offline and read from disk at runtime."""

    session_id: str
    built_at: str
    source: str = Field(description="Which providers produced this, for the provenance line")
    lap_count: int | None = None
    circuit_corners: int | None = None
    lap_length_m: float | None = None
    track_evolution: list[TrackEvolutionPoint] = []
    wet_dry_crossovers: list[int] = Field(
        default=[], description="Laps where the rainfall sensor changed state"
    )
    stints_by_driver: dict[str, list[StintSummary]] = {}
    clip_contexts: dict[str, ClipContext] = {}
    unmatched_clips: list[str] = Field(
        default=[],
        description="Clips we could not give an exact timestamp. Named, never silently dropped.",
    )


# --------------------------------------------------------------------------
# LLM-authored findings
#
# Distinct from StrategyCall on purpose. A StrategyCall is a rule firing, and
# must be reproducible. A Finding is a ranked, cross-domain reading of the whole
# session written by a language model. Keeping them separate means the pit wall
# never has to wonder which kind of thing it is looking at.
# --------------------------------------------------------------------------


class Finding(BaseModel):
    rank: int = Field(description="1 is the most actionable, not the most severe")
    severity: Urgency
    headline: str
    detail: str
    laps: list[int] = Field(
        default=[],
        description=(
            "Laps this finding is about. Validated against the timeline before "
            "the finding is returned; a finding citing a lap we have no data for "
            "is dropped rather than shown."
        ),
    )
    domains: list[str] = Field(
        default=[], description="Which context domains this draws on: stress/pace/track/tyre/position/situation"
    )
    evidence: list[str] = Field(
        default=[], description="The specific values behind the claim, so an engineer can check it"
    )
    confidence: float = Field(ge=0, le=1)


class FindingsResponse(BaseModel):
    session_id: str
    driver: str
    mode: ScoringMode
    findings: list[Finding]
    model: str = Field(description="LLM that wrote these, shown in the UI provenance line")
    context_domains: list[str] = Field(
        default=[], description="Domains actually present in the context this was generated from"
    )
    dropped_findings: int = Field(
        default=0,
        description=(
            "How many the citation gate rejected for referencing data we do not "
            "have. Surfaced rather than hidden: a non-zero value is a real signal "
            "about the model's reliability on this session."
        ),
    )
    cached: bool = False


# The race-context models are declared after Timeline (grouped by concern rather
# than by dependency order), so the forward references in Timeline and
# TimelinePoint need an explicit rebuild. Pydantic would resolve these lazily on
# first use, but FastAPI generates the OpenAPI schema at import time and a
# half-built model there surfaces as a confusing startup error rather than a
# clear one.
TimelinePoint.model_rebuild()
Timeline.model_rebuild()
