/**
 * Mirror of backend/app/schemas.py.
 *
 * Hand-maintained rather than generated: the contract is frozen and small, and
 * a codegen step is one more thing to break at 2am. If you change schemas.py,
 * change this file in the same commit.
 */

export type Mood = 'Calm' | 'Stressed' | 'Tired'
export type ScoringMode = 'naive' | 'fusion'
export type Urgency = 'info' | 'warning' | 'critical'

export type StrategyCode =
  | 'BOX_NOW'
  | 'PIT_WINDOW_OPENING'
  | 'HOLD'
  | 'REDUCE_RADIO_LOAD'
  | 'MONITOR'

export interface Word {
  text: string
  start: number
  end: number
}

export interface Transcript {
  text: string
  words: Word[]
  language: string
  stt_model: string
}

export interface ProsodySignal {
  score: number
  f0_mean_z: number
  f0_std_z: number
  rms_mean_z: number
  speech_rate_z: number
  pause_ratio_z: number
  jitter_z: number | null
}

export interface AcousticSignal {
  score: number
  probabilities: Record<string, number>
  top_label: string
  model_id: string
}

export interface TextSignal {
  score: number
  probabilities: Record<string, number>
  top_label: string
  model_id: string
}

export interface SignalBreakdown {
  prosody: ProsodySignal
  acoustic: AcousticSignal
  text: TextSignal
}

export interface MoodResult {
  mood: Mood
  confidence: number
  stress_index: number
  probabilities: Record<Mood, number>
  mode: ScoringMode
  /** False when the fusion head is untrained and the fallback produced this. */
  fitted: boolean
}

export interface ClipAnalysis {
  clip_id: string
  driver: string
  session_id: string
  lap: number | null
  duration_s: number
  audio_url: string
  transcript: Transcript
  signals: SignalBreakdown
  fusion: MoodResult
  naive: MoodResult
  processing_ms: number
  cached: boolean
}

export interface SessionMeta {
  session_id: string
  year: number
  event_name: string
  session_type: string
  drivers: string[]
  cached: boolean
}

export interface StrategyCall {
  lap: number
  code: StrategyCode
  headline: string
  rationale: string
  urgency: Urgency
}

export interface LeadLagPoint {
  lag_laps: number
  /** null when too few clip/lap pairs exist at this offset — not the same as 0. */
  correlation: number | null
  n_pairs: number
}

/** One row in the clip library. Returned by GET /api/clips/library. */
export interface ClipSummary {
  clip_id: string
  session_id: string
  driver: string
  lap: number | null
  audio_url: string
  label: string | null
  analysed: boolean
  mood: Mood | null
  stress_index: number | null
}

export interface LeadLagAnalysis {
  curve: LeadLagPoint[]
  peak_lag_laps: number
  peak_correlation: number
  n_samples: number
  interpretation: string
  is_significant: boolean
}

export interface TimelinePoint {
  lap: number
  delta_s: number | null
  stress_index: number | null
  mood: Mood | null
  clip_id: string | null
  /**
   * Race context per lap. Present for every lap once context is built — track
   * and tyre come from the lap frame and the session-wide weather curve, not
   * only from laps that happen to have a radio call, so compound bands and rain
   * overlays are continuous rather than dotted.
   */
  track: TrackConditions | null
  tyre: TyreState | null
  situation: RaceSituation | null
}

export interface MoodSpecificBaseline {
  n_clips: number
  f0_mean: number
  rms_mean: number
  speech_rate: number
  f0_std: number
  rms_std: number
  speech_rate_std: number
}

export interface DriverBaseline {
  driver: string
  n_baseline_clips: number
  f0_mean: number
  rms_mean: number
  speech_rate: number
  /** 'prior' means population defaults — do NOT claim per-driver calibration. */
  source: 'driver' | 'cohort' | 'prior'
  /** Baseline features grouped by mood (Calm, Tired, Stressed) */
  mood_baselines: Record<string, MoodSpecificBaseline | null>
}

export interface Timeline {
  session: SessionMeta
  driver: string
  mode: ScoringMode
  points: TimelinePoint[]
  clips: ClipAnalysis[]
  strategy_calls: StrategyCall[]
  lead_lag: LeadLagAnalysis | null
  baseline: DriverBaseline | null
  /** Null until scripts/build_context.py has been run for this session. */
  session_context: SessionContext | null
  clip_contexts: Record<string, ClipContext>
  biometrics: BiometricSeries | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * Race context — what was true at a given instant.
 *
 * Every field is optional or nullable on purpose: a session with no context
 * built renders exactly as the dashboard did before this layer existed.
 * ──────────────────────────────────────────────────────────────────────────── */

export type ContextDomain =
  | 'stress'
  | 'pace'
  | 'track'
  | 'tyre'
  | 'position'
  | 'situation'
  | 'radio'

/** Where in the session a radio call sits. Grid nerves are not race stress. */
export type SessionPhase = 'pre_race' | 'racing' | 'post_race'

export type TrackZone = 'braking' | 'high_speed' | 'corner' | 'pit_lane' | 'other'

export interface TrackConditions {
  air_temp_c: number | null
  track_temp_c: number | null
  /** F1's binary wet/dry sensor, not a rate. */
  rainfall: boolean | null
  humidity_pct: number | null
  pressure_hpa: number | null
  wind_speed_ms: number | null
  wind_direction_deg: number | null
  /** Negative means the surface is cooling, which costs front grip. */
  track_temp_delta_from_start_c: number | null
  /** Field median lap time. A proxy for grip, not a measurement of it. */
  grip_proxy_s: number | null
  is_wet: boolean | null
}

/**
 * Modelled tyre condition.
 *
 * There is no public source of real F1 tyre temperature, pressure or wear — teams
 * do not release it. `basis` is the literal string 'modelled' rather than a
 * boolean flag so that any component rendering this can see what it is holding,
 * and so the UI can never imply a measurement. Always show it.
 */
export interface TyreState {
  compound: string | null
  tyre_age_laps: number | null
  stint_number: number | null
  laps_into_stint: number | null
  /** Seconds per lap. Positive means losing time. Null when the stint is too short to fit. */
  deg_slope_s_per_lap: number | null
  stint_vs_driver_median_laps: number | null
  past_cliff: boolean | null
  basis: 'modelled'
}

export interface TrackPosition {
  distance_into_lap_m: number | null
  lap_length_m: number | null
  pct_of_lap: number | null
  /** Turn number from circuit geometry. */
  nearest_corner: number | null
  /** Signed: negative means the corner is behind the car. */
  distance_to_corner_m: number | null
  sector: number | null
  speed_kph: number | null
  throttle_pct: number | null
  brake: boolean | null
  gear: number | null
  rpm: number | null
  drs_active: boolean | null
  zone: TrackZone | null
}

export interface RaceControlEvent {
  utc: string
  lap: number | null
  category: string | null
  flag: string | null
  scope: string | null
  message: string
  /** Seconds relative to the moment being explained; negative means before. */
  offset_s: number
}

export interface RaceSituation {
  position: number | null
  gap_ahead_s: number | null
  gap_to_leader_s: number | null
  track_status: string | null
  active_flags: string[]
  nearby_messages: RaceControlEvent[]
  in_traffic: boolean | null
}

export interface BiometricPoint {
  utc: string
  lap: number | null
  hr_bpm: number | null
  hrv_ms: number | null
  core_temp_c: number | null
  hr_z: number | null
  hrv_z: number | null
}

export interface BiometricSeries {
  driver: string
  session_id: string
  source: string
  n_samples: number
  samples: BiometricPoint[]
  hr_baseline_bpm: number | null
  hr_baseline_sd: number | null
  coverage_note: string | null
}

export interface ClipContext {
  clip_id: string
  utc: string
  lap: number | null
  phase: SessionPhase | null
  resolved_from: 'utc' | 'lap'
  track: TrackConditions | null
  tyre: TyreState | null
  position: TrackPosition | null
  situation: RaceSituation | null
  biometrics: BiometricPoint | null
}

export interface StintSummary {
  stint_number: number
  compound: string | null
  lap_start: number
  lap_end: number
  n_laps: number
  best_lap_s: number | null
  deg_slope_s_per_lap: number | null
  basis: 'modelled'
}

export interface TrackEvolutionPoint {
  lap: number
  grip_proxy_s: number | null
  track_temp_c: number | null
  air_temp_c: number | null
  rainfall: boolean | null
}

export interface SessionContext {
  session_id: string
  built_at: string
  source: string
  lap_count: number | null
  circuit_corners: number | null
  lap_length_m: number | null
  track_evolution: TrackEvolutionPoint[]
  /** Laps where the rainfall sensor changed state. */
  wet_dry_crossovers: number[]
  stints_by_driver: Record<string, StintSummary[]>
  clip_contexts: Record<string, ClipContext>
  /** Clips we could not timestamp. Named, never silently dropped. */
  unmatched_clips: string[]
}

/* ────────────────────────────────────────────────────────────────────────────
 * LLM-authored findings.
 *
 * Deliberately distinct from StrategyCall. A StrategyCall is a rule firing and is
 * reproducible; a Finding is a language model's ranked reading of the whole
 * session. The UI must never present them as the same kind of thing.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Finding {
  /** 1 is the most actionable, not the most severe. */
  rank: number
  severity: Urgency
  headline: string
  detail: string
  /** Validated against the timeline server-side; safe to make clickable. */
  laps: number[]
  domains: ContextDomain[]
  evidence: string[]
  confidence: number
}

export interface FindingsResponse {
  session_id: string
  driver: string
  mode: ScoringMode
  findings: Finding[]
  /** Shown in the provenance line so the UI never hides which model wrote these. */
  model: string
  context_domains: ContextDomain[]
  /**
   * How many findings the citation gate rejected for referencing data we do not
   * have. Surfaced rather than hidden: non-zero is a real signal about how much
   * to trust the rest.
   */
  dropped_findings: number
  cached: boolean
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  models_loaded: Record<string, boolean>
  offline_ready: boolean
}

/**
 * Progress streaming — mirror of PipelineStage / ProgressEvent in schemas.py.
 *
 * `received` and `error` are declared by the backend enum; only `error` is ever
 * emitted in practice (pipeline/run.py starts at `preprocess`).
 */
export type PipelineStage =
  | 'received'
  | 'preprocess'
  | 'vad'
  | 'stt'
  | 'prosody'
  | 'acoustic'
  | 'text'
  | 'fusion'
  | 'align'
  | 'done'
  | 'error'

export interface ProgressEvent {
  clip_id: string
  stage: PipelineStage
  message: string
  /** Cumulative, from the moment the socket opened — not per-stage. */
  elapsed_ms: number
  detail?: Record<string, string | number>
}

/**
 * Mood is a *state*, so it takes status colors — but red/green fail CVD
 * separation (ΔE 4.1 deutan), so these are never allowed to carry meaning
 * alone. Every use pairs the color with the mood word, and on chart marks with
 * a distinct shape too.
 */
export const MOOD_COLOR: Record<Mood, string> = {
  Calm: 'var(--status-good)',      // #00ff88 - Bright green
  Stressed: 'var(--status-warning)',  // #ffaa00 - Bright orange/amber
  Tired: 'var(--status-critical)',     // #ff0050 - Hot pink/red
}

/** The secondary encoding that makes mood readable without color. */
export const MOOD_SHAPE: Record<Mood, 'circle' | 'triangle' | 'square'> = {
  Calm: 'circle',
  Stressed: 'triangle',
  Tired: 'square',
}

export const URGENCY_COLOR: Record<Urgency, string> = {
  info: '#A8B0BF', // Brightened from text-muted for better visibility as status tag
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
}
