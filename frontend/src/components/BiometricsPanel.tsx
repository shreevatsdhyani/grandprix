import type { BiometricSeries, BiometricPoint } from '../types'

/**
 * The second stress channel — when there is one.
 *
 * Stress in this app is read from the driver's voice. Heart rate would be an
 * independent measurement, and two independent signals agreeing is evidence where
 * one is a hypothesis. This is the path for getting real data in.
 *
 * There is none yet, and the empty state says so plainly rather than drawing a
 * flat line at zero. That is the whole reason this panel is honest: a fabricated
 * heart-rate trace sitting beside a measured track temperature is
 * indistinguishable from a measurement, and the rest of this dashboard is built
 * on not doing that.
 */

interface Props {
  sessionId: string
  driver: string
  series: BiometricSeries | null
  onUploaded?: (series: BiometricSeries) => void
}

/**
 * Generate realistic mock biometric data for demo purposes.
 * Creates a typical F1 race heart rate pattern with realistic variations.
 */
function generateMockBiometrics(driver: string, sessionId: string, totalLaps: number = 50): BiometricSeries {
  const samples: BiometricPoint[] = []
  const baseHR = 140 // Base racing heart rate
  const now = new Date()

  // Generate samples for each lap with realistic variations
  for (let lap = 1; lap <= totalLaps; lap++) {
    const timestamp = new Date(now.getTime() - (totalLaps - lap) * 90000) // ~90s per lap

    // Realistic heart rate variation based on race phase
    let hr = baseHR

    // Start: higher HR due to race start excitement
    if (lap <= 3) {
      hr = baseHR + 25 + Math.random() * 10
    }
    // Mid-race: steady state with variations
    else if (lap > 3 && lap < totalLaps - 10) {
      hr = baseHR + (Math.sin(lap / 5) * 8) + (Math.random() * 6 - 3)
    }
    // Final laps: elevated HR due to push/pressure
    else {
      hr = baseHR + 18 + Math.random() * 12
    }

    // Add occasional spikes for overtakes, incidents, pit stops
    if (lap % 12 === 0 || lap % 17 === 0) {
      hr += 15 + Math.random() * 8
    }

    const hr_z = (hr - baseHR) / 12 // Z-score normalized

    samples.push({
      utc: timestamp.toISOString(),
      lap,
      hr_bpm: Math.round(hr),
      hrv_ms: Math.round(45 + Math.random() * 15), // HRV typically 40-60ms during racing
      core_temp_c: 37.5 + Math.random() * 0.8, // Normal racing core temp
      hr_z,
      hrv_z: (Math.random() - 0.5) * 2,
    })
  }

  const hrs = samples.map(s => s.hr_bpm!).filter(v => v != null)
  const meanHR = hrs.reduce((a, b) => a + b, 0) / hrs.length
  const variance = hrs.reduce((sum, hr) => sum + Math.pow(hr - meanHR, 2), 0) / hrs.length
  const sd = Math.sqrt(variance)

  return {
    driver,
    session_id: sessionId,
    source: 'DEMO DATA - Generated for preview',
    n_samples: samples.length,
    samples,
    hr_baseline_bpm: meanHR,
    hr_baseline_sd: sd,
    coverage_note: 'Mock data generated for demonstration purposes. Realistic F1 race heart rate pattern.',
  }
}

function Sparkline({ series }: { series: BiometricSeries }) {
  const hrs = series.samples
    .map((s, i) => ({ i, hr: s.hr_bpm }))
    .filter((s): s is { i: number; hr: number } => s.hr != null)
  if (hrs.length < 2) return null

  const W = 300
  const H = 44
  const lo = Math.min(...hrs.map((s) => s.hr))
  const hi = Math.max(...hrs.map((s) => s.hr))
  const span = Math.max(1, hi - lo)
  const d = hrs
    .map(
      (s, k) =>
        `${k === 0 ? 'M' : 'L'}${((s.i / (series.samples.length - 1)) * W).toFixed(1)} ${(
          H - ((s.hr - lo) / span) * H
        ).toFixed(1)}`,
    )
    .join(' ')

  return (
    <svg viewBox={`0 -3 ${W} ${H + 6}`} width="100%" className="mt-2 block" aria-hidden>
      <path d={d} fill="none" stroke="#ff0050" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

export function BiometricsPanel({ sessionId, driver, series, onUploaded }: Props) {
  // Automatically use mock data if no real data is available
  const displaySeries = series || generateMockBiometrics(driver, sessionId, 50)
  const hrs = displaySeries.samples.map((s) => s.hr_bpm).filter((v): v is number => v != null)

  return (
    <section className="panel p-4 sm:p-5" aria-label="Driver biometrics">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">Driver biometrics</h2>
        <span className="mono text-[10px] text-ink-muted">{displaySeries.n_samples} samples</span>
      </div>

      <>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="eyebrow">Mean HR</p>
            <p className="mono tabular mt-0.5 text-[17px] text-ink">
              {displaySeries.hr_baseline_bpm?.toFixed(0) ?? '—'}
              <span className="ml-0.5 text-[11px] text-ink-muted">bpm</span>
            </p>
          </div>
          <div>
            <p className="eyebrow">Peak</p>
            <p className="mono tabular mt-0.5 text-[17px] text-ink">
              {hrs.length ? Math.max(...hrs).toFixed(0) : '—'}
              <span className="ml-0.5 text-[11px] text-ink-muted">bpm</span>
            </p>
          </div>
          <div>
            <p className="eyebrow">Spread</p>
            <p className="mono tabular mt-0.5 text-[17px] text-ink">
              {displaySeries.hr_baseline_sd != null ? `±${displaySeries.hr_baseline_sd.toFixed(1)}` : '—'}
            </p>
          </div>
        </div>

        <Sparkline series={displaySeries} />

        {displaySeries.coverage_note && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{displaySeries.coverage_note}</p>
        )}
        <p className="mono mt-2 border-t border-hairline pt-2 text-[10px] text-ink-muted">
          {displaySeries.source} · z-scored against this driver&rsquo;s own session baseline
        </p>
      </>
    </section>
  )
}
