import type { Mood, Timeline } from '../types'

/**
 * One sentence and four numbers, derived from the timeline the backend already
 * sends.
 *
 * The dashboard could always answer "did the voice lead the stopwatch?" — but
 * only by reading two charts and a correlation curve. This collapses that into
 * the claim itself, so the answer is the first thing on the page and the charts
 * below become the evidence for it rather than the question.
 *
 * Nothing here invents a number. The lead comes from the backend's lead-lag
 * peak, and `significant` is carried through untouched so the headline can hedge
 * when the sample is too small to support it.
 */

export interface Verdict {
  state: 'lead' | 'no-lead' | 'no-clips'
  /** Laps of warning: how far the stress peak sits ahead of the pace drop. */
  leadLaps: number | null
  /**
   * The backend's peak lag, signed and untouched: negative means the voice moved
   * first, positive means the pace did. Carried separately from `leadLaps`
   * because "no lead" and "not measurable" are different answers, and a panel
   * showing a dash for the first needs to be able to say which one it means.
   */
  lagLaps: number | null
  headline: string
  /** The qualifying line under the headline, in the interface's voice. */
  support: string
  significant: boolean
  peakStress: { lap: number; value: number; mood: Mood; clipId: string | null } | null
  /** Lap the pace went away, per the lead-lag offset. */
  paceLossLap: number | null
  correlation: number | null
  nSamples: number
  callCount: number
  criticalCall: string | null
}

export function readVerdict(timeline: Timeline | null): Verdict | null {
  if (!timeline) return null

  const scored = timeline.points.filter(
    (p): p is typeof p & { stress_index: number; mood: Mood } =>
      p.stress_index != null && p.mood != null,
  )

  const peak = scored.reduce<Verdict['peakStress']>((best, p) => {
    if (best && best.value >= p.stress_index) return best
    return { lap: p.lap, value: p.stress_index, mood: p.mood, clipId: p.clip_id }
  }, null)

  const lag = timeline.lead_lag
  // A negative peak lag means stress moved first — that is the whole claim.
  const leadLaps = lag && lag.peak_lag_laps < 0 ? Math.abs(lag.peak_lag_laps) : null
  const significant = lag?.is_significant ?? false

  const calls = timeline.strategy_calls
  // Most urgent first, falling back to whatever did fire. A count of 2 next to
  // "nothing triggered" reads as a bug even when both calls are only advisory.
  const criticalCall =
    calls.find((c) => c.urgency === 'critical')?.headline ??
    calls.find((c) => c.urgency === 'warning')?.headline ??
    calls[0]?.headline ??
    null

  const base = {
    significant,
    peakStress: peak,
    lagLaps: lag?.peak_lag_laps ?? null,
    correlation: lag?.peak_correlation ?? null,
    nSamples: lag?.n_samples ?? 0,
    callCount: calls.length,
    criticalCall,
  }

  if (!peak) {
    return {
      ...base,
      state: 'no-clips',
      leadLaps: null,
      paceLossLap: null,
      headline: 'No radio scored for this driver yet',
      support:
        'Race pace below is real FastF1 timing. Pick a clip from the library on the right to score one, or upload your own.',
    }
  }

  if (leadLaps == null) {
    return {
      ...base,
      state: 'no-lead',
      leadLaps: null,
      paceLossLap: null,
      headline: `Peak stress ${Math.round(peak.value)} at lap ${peak.lap}`,
      support:
        lag && lag.n_samples > 0
          ? // "laps", not "calls". leadlag.py counts distinct laps carrying a
            // stress score, so several radio calls on one lap collapse to one
            // sample — and the KPI caption beside this line already says laps.
            `No lead detected across ${lag.n_samples} scored ${
              lag.n_samples === 1 ? 'lap' : 'laps'
            } — the voice moves with the stopwatch here, not ahead of it.`
          : 'Too few scored calls in this session to test whether the voice moves first.',
    }
  }

  const lapWord = leadLaps === 1 ? 'lap' : 'laps'
  return {
    ...base,
    state: 'lead',
    leadLaps,
    paceLossLap: peak.lap + leadLaps,
    headline: `The voice cracked ${leadLaps} ${lapWord} before the stopwatch`,
    support: `Stress peaked at ${Math.round(peak.value)} on lap ${peak.lap}. Pace went away on lap ${
      peak.lap + leadLaps
    }. That gap is the pit wall's warning.`,
  }
}
