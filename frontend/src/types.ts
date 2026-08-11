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
  correlation: number
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
}

export interface DriverBaseline {
  driver: string
  n_baseline_clips: number
  f0_mean: number
  rms_mean: number
  speech_rate: number
  /** 'prior' means population defaults — do NOT claim per-driver calibration. */
  source: 'driver' | 'cohort' | 'prior'
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
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  models_loaded: Record<string, boolean>
  offline_ready: boolean
}

/**
 * Mood is a *state*, so it takes status colors — but red/green fail CVD
 * separation (ΔE 4.1 deutan), so these are never allowed to carry meaning
 * alone. Every use pairs the color with the mood word, and on chart marks with
 * a distinct shape too.
 */
export const MOOD_COLOR: Record<Mood, string> = {
  Calm: 'var(--status-good)',
  Stressed: 'var(--status-warning)',
  Tired: 'var(--status-critical)',
}

/** The secondary encoding that makes mood readable without color. */
export const MOOD_SHAPE: Record<Mood, 'circle' | 'triangle' | 'square'> = {
  Calm: 'circle',
  Stressed: 'triangle',
  Tired: 'square',
}

export const URGENCY_COLOR: Record<Urgency, string> = {
  info: 'var(--text-muted)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
}
