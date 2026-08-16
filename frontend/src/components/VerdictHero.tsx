import type { Circuit } from '../lib/circuits'
import type { Driver } from '../lib/drivers'
import type { Verdict } from '../lib/verdict'
import type { ScoringMode } from '../types'
import { CircuitMap } from './CircuitMap'
import { DriverPlate } from './DriverPlate'

/**
 * The answer, before the evidence.
 *
 * Everything below this band is a chart that can support or undermine one
 * claim, and the claim used to be reachable only by reading all of them. Here
 * it is stated outright at signage size, with the four numbers behind it and
 * the caveat attached, so someone who reads nothing else still leaves knowing
 * what the project found.
 */

interface Props {
  verdict: Verdict
  driver: Driver
  circuit: Circuit | null
  eventName: string
  year: number
  mode: ScoringMode
  /** Jump the rest of the page to the lap the verdict is about. */
  onSelectClip?: (clipId: string) => void
}

export function VerdictHero({
  verdict,
  driver,
  circuit,
  eventName,
  year,
  mode,
  onSelectClip,
}: Props) {
  const lead = verdict.state === 'lead'

  return (
    <section
      className="panel relative overflow-hidden"
      aria-label="Session verdict"
      style={{
        background:
          'radial-gradient(120% 140% at 88% 8%, color-mix(in srgb, var(--team) 13%, transparent) 0%, transparent 58%), linear-gradient(180deg, #10131a 0%, #0b0d12 100%)',
      }}
    >
      {/* The venue, running the lap. Sits behind the copy and is deliberately
          low-contrast: it is orientation, not information. */}
      {circuit && (
        <div
          className="pointer-events-none absolute bottom-[86px] right-0 top-9 hidden w-[38%] max-w-[460px] items-center justify-end pr-2 opacity-90 md:flex"
          aria-hidden
        >
          <CircuitMap
            circuit={circuit}
            color={driver.team.color}
            variant="hero"
            className="h-full w-full"
          />
        </div>
      )}

      {/* ── Venue strip ─────────────────────────────────────────────────── */}
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline px-4 py-2.5 sm:px-5">
        <span className="text-base leading-none" aria-hidden>
          {circuit?.flag ?? '🏁'}
        </span>
        <span className="tower text-ink-primary" style={{ fontSize: 15, letterSpacing: '0.05em' }}>
          {eventName.toUpperCase()} {year}
        </span>
        {circuit && (
          <span className="hidden text-[11px] text-ink-muted sm:inline">
            {circuit.short} · {circuit.laps} laps · {circuit.km.toFixed(3)} km ·{' '}
            {circuit.turns} turns
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span
            className="chip"
            style={{ color: mode === 'fusion' ? 'var(--series-1)' : 'var(--status-warning)' }}
          >
            {mode === 'fusion' ? 'Fusion model' : 'Single model'}
          </span>
        </span>
      </div>

      {/* ── Claim ───────────────────────────────────────────────────────── */}
      <div className="relative grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-7">
        <DriverPlate driver={driver} />

        <div className="relative min-w-0 self-center">
          <p className="eyebrow">The finding</p>

          <h1
            className="display mt-2 text-balance text-ink-primary"
            style={{ fontSize: 'clamp(26px, 3.2vw, 42px)' }}
          >
            {lead ? (
              <>
                The voice cracked{' '}
                <span
                  style={{
                    color: 'var(--status-critical)',
                    textShadow: '0 0 34px rgba(255,0,80,0.45)',
                  }}
                >
                  {verdict.leadLaps} {verdict.leadLaps === 1 ? 'lap' : 'laps'}
                </span>{' '}
                before the stopwatch
              </>
            ) : (
              verdict.headline
            )}
          </h1>

          <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink-secondary sm:text-sm">
            {verdict.support}
          </p>

          {lead && !verdict.significant && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-status-warning">
              <span aria-hidden>▲</span>
              <span>
                Indicative only — {verdict.nSamples} scored calls is below our significance
                threshold. Read it as a direction of travel, not a proven effect.
              </span>
            </p>
          )}
        </div>
      </div>

      {/* ── The four numbers ────────────────────────────────────────────── */}
      <div className="relative grid grid-cols-2 gap-px border-t border-hairline bg-hairline lg:grid-cols-4">
        <Stat
          label="Warning time"
          value={verdict.leadLaps != null ? String(verdict.leadLaps) : '—'}
          unit={verdict.leadLaps != null ? (verdict.leadLaps === 1 ? 'lap' : 'laps') : undefined}
          note={verdict.leadLaps != null ? 'stress peak ahead of pace loss' : 'no lead detected'}
          tone={verdict.leadLaps != null ? 'var(--status-critical)' : 'var(--slate)'}
        />
        <Stat
          label="Peak stress"
          value={verdict.peakStress ? String(Math.round(verdict.peakStress.value)) : '—'}
          unit={verdict.peakStress ? '/100' : undefined}
          note={
            verdict.peakStress
              ? `${verdict.peakStress.mood.toLowerCase()} · lap ${verdict.peakStress.lap}`
              : 'nothing scored yet'
          }
          tone="var(--status-warning)"
          onClick={
            verdict.peakStress?.clipId && onSelectClip
              ? () => onSelectClip(verdict.peakStress!.clipId!)
              : undefined
          }
        />
        <Stat
          label="Strategy calls"
          value={String(verdict.callCount)}
          note={verdict.criticalCall ?? 'nothing triggered'}
          tone={verdict.callCount > 0 ? 'var(--series-1)' : 'var(--slate)'}
        />
        <Stat
          label="Correlation"
          value={verdict.correlation != null ? verdict.correlation.toFixed(2) : '—'}
          unit={verdict.correlation != null ? 'r' : undefined}
          note={`${verdict.nSamples} scored call${verdict.nSamples === 1 ? '' : 's'}${
            verdict.significant ? '' : ' · indicative'
          }`}
          tone="var(--series-3)"
        />
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  unit,
  note,
  tone,
  onClick,
}: {
  label: string
  value: string
  unit?: string
  note: string
  tone: string
  onClick?: () => void
}) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tower" style={{ fontSize: 'clamp(30px, 4vw, 40px)', color: tone }}>
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-ink-muted">{unit}</span>}
      </p>
      <p className="mt-1 truncate text-[11px] text-ink-muted" title={note}>
        {note}
      </p>
    </>
  )

  const className = 'bg-surface px-4 py-3.5 text-left sm:px-5'

  return onClick ? (
    <button onClick={onClick} className={`${className} transition hover:bg-raised`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}
