import { useRef, useState } from 'react'
import { uploadBiometrics } from '../api'
import type { BiometricSeries } from '../types'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const result = await uploadBiometrics(file, sessionId, driver)
      onUploaded?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const hrs = series?.samples.map((s) => s.hr_bpm).filter((v): v is number => v != null) ?? []

  return (
    <section className="panel p-4 sm:p-5" aria-label="Driver biometrics">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">Driver biometrics</h2>
        {series && <span className="mono text-[10px] text-ink-muted">{series.n_samples} samples</span>}
      </div>

      {series ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <p className="eyebrow">Mean HR</p>
              <p className="mono tabular mt-0.5 text-[17px] text-ink">
                {series.hr_baseline_bpm?.toFixed(0) ?? '—'}
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
                {series.hr_baseline_sd != null ? `±${series.hr_baseline_sd.toFixed(1)}` : '—'}
              </p>
            </div>
          </div>

          <Sparkline series={series} />

          {series.coverage_note && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{series.coverage_note}</p>
          )}
          <p className="mono mt-2 border-t border-hairline pt-2 text-[10px] text-ink-muted">
            {series.source} · z-scored against this driver&rsquo;s own session baseline
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            No heart-rate data for {driver} in this session. Stress on this page is read from
            the driver&rsquo;s voice alone — nothing here is estimated to fill the gap.
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-3 w-full rounded-lg border border-dashed border-hairline-bright px-3 py-2.5 text-[12px] text-ink-secondary transition hover:border-accent-cyan hover:text-ink disabled:opacity-50"
          >
            {busy ? 'Reading file…' : 'Add a heart-rate file'}
          </button>
          <p className="mono mt-1.5 text-[10px] leading-relaxed text-ink-muted">
            CSV or JSON with a <span className="text-ink-secondary">utc</span> column plus any of{' '}
            <span className="text-ink-secondary">hr_bpm</span>,{' '}
            <span className="text-ink-secondary">hrv_ms</span>,{' '}
            <span className="text-ink-secondary">core_temp_c</span>
          </p>
        </>
      )}

      {error && (
        <p className="mt-2 text-[11px] leading-relaxed text-status-warning">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void submit(f)
        }}
      />
    </section>
  )
}
