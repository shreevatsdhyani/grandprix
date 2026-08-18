import { useMemo } from 'react'
import type { SessionContext, TrackEvolutionPoint } from '../types'

/**
 * What the track was doing underneath the driver.
 *
 * Track temperature is the number that matters and the one nobody quotes: it
 * swings far wider than air temperature — Silverstone 2024 ran 33°C down to 21°C
 * and back — and a cooling surface costs front grip, which is what produces
 * understeer complaints on the radio. So the trace is track temperature, with air
 * temperature behind it for reference, and the wet laps shaded.
 *
 * Drawn as a bare SVG rather than a chart library: it is one line, one reference
 * line and some shaded spans, and the panel is small enough that a chart
 * library's axes and legends would take more room than the data.
 */

const WET = '#0067AD'

/** Shared empty array so the memo dependency is referentially stable. */
const EMPTY_EVOLUTION: TrackEvolutionPoint[] = []

interface Props {
  context: SessionContext | null
  /** Highlighted lap, driven by the same selection as the rest of the page. */
  selectedLap?: number | null
  onSelectLap?: (lap: number) => void
}

function Readout({
  label,
  value,
  unit,
  hint,
}: {
  label: string
  value: string
  unit?: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 truncate">
        <span className="mono tabular text-[17px] text-ink">{value}</span>
        {unit && <span className="mono ml-0.5 text-[11px] text-ink-muted">{unit}</span>}
      </p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-ink-muted">{hint}</p>}
    </div>
  )
}

export function TrackConditions({ context, selectedLap, onSelectLap }: Props) {
  // Read off `context` rather than a defaulted local, so the memo below has a
  // stable dependency. `?? []` on every render would invalidate it each time.
  const evo = context?.track_evolution ?? EMPTY_EVOLUTION

  const stats = useMemo(() => {
    const withTemp = evo.filter(
      (e): e is TrackEvolutionPoint & { track_temp_c: number } => e.track_temp_c != null,
    )
    if (withTemp.length === 0) return null
    const lo = withTemp.reduce((a, b) => (b.track_temp_c < a.track_temp_c ? b : a))
    const hi = withTemp.reduce((a, b) => (b.track_temp_c > a.track_temp_c ? b : a))
    const wetLaps = evo.filter((e) => e.rainfall === true).map((e) => e.lap)
    return {
      withTemp,
      start: withTemp[0],
      end: withTemp.at(-1)!,
      lo,
      hi,
      swing: hi.track_temp_c - lo.track_temp_c,
      wetLaps,
    }
  }, [evo])

  if (!context || !stats) {
    return (
      <section className="panel p-4 sm:p-5" aria-label="Track conditions">
        <h2 className="card-title">Track conditions</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          No weather resolved for this session. Run{' '}
          <span className="mono text-[11px]">scripts/build_context.py</span> to build it.
        </p>
      </section>
    )
  }

  const { start, end, lo, hi, swing, wetLaps } = stats
  const laps = evo.map((e) => e.lap)
  const minLap = Math.min(...laps)
  const maxLap = Math.max(...laps)
  const lapSpan = Math.max(1, maxLap - minLap)

  const airs = evo.map((e) => e.air_temp_c).filter((v): v is number => v != null)
  const tMin = Math.min(lo.track_temp_c, ...airs) - 1.5
  const tMax = Math.max(hi.track_temp_c, ...airs) + 1.5
  const tSpan = Math.max(1, tMax - tMin)

  const W = 300
  const H = 88
  const x = (lap: number) => ((lap - minLap) / lapSpan) * W
  const y = (t: number) => H - ((t - tMin) / tSpan) * H

  const line = (get: (e: TrackEvolutionPoint) => number | null) => {
    const segs: string[] = []
    let open = false
    for (const e of evo) {
      const v = get(e)
      if (v == null) {
        open = false
        continue
      }
      segs.push(`${open ? 'L' : 'M'}${x(e.lap).toFixed(1)} ${y(v).toFixed(1)}`)
      open = true
    }
    return segs.join(' ')
  }

  // Contiguous wet spans, so the shading is one rect per span rather than per lap.
  const wetSpans: { from: number; to: number }[] = []
  for (const lap of wetLaps) {
    const last = wetSpans.at(-1)
    if (last && last.to === lap - 1) last.to = lap
    else wetSpans.push({ from: lap, to: lap })
  }

  const selected = selectedLap != null ? evo.find((e) => e.lap === selectedLap) : undefined

  return (
    <section className="panel flex flex-col p-4 sm:p-5" aria-label="Track conditions">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">Track conditions</h2>
        <span className="mono text-[10px] text-ink-muted">
          {wetLaps.length > 0 ? `${wetLaps.length} wet laps` : 'dry throughout'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Readout
          label="Track now"
          value={
            selected?.track_temp_c != null
              ? selected.track_temp_c.toFixed(1)
              : end.track_temp_c.toFixed(1)
          }
          unit="°C"
          hint={selected ? `lap ${selected.lap}` : `lap ${end.lap}`}
        />
        <Readout
          label="Swing"
          value={swing.toFixed(1)}
          unit="°C"
          hint={`${hi.track_temp_c.toFixed(0)}° L${hi.lap} → ${lo.track_temp_c.toFixed(0)}° L${lo.lap}`}
        />
        <Readout
          label="Air"
          value={
            selected?.air_temp_c != null
              ? selected.air_temp_c.toFixed(1)
              : (end.air_temp_c?.toFixed(1) ?? '—')
          }
          unit="°C"
        />
      </div>

      <svg
        viewBox={`0 -6 ${W} ${H + 22}`}
        width="100%"
        className="mt-3 block"
        role="img"
        aria-label={`Track temperature from ${start.track_temp_c.toFixed(0)} to ${end.track_temp_c.toFixed(0)} degrees over ${evo.length} laps`}
      >
        {wetSpans.map((s) => (
          <rect
            key={`wet-${s.from}`}
            x={x(s.from)}
            y={-6}
            width={Math.max(1.5, x(s.to + 1) - x(s.from))}
            height={H + 6}
            fill={WET}
            fillOpacity={0.16}
          />
        ))}

        {/* Crossover laps: where tyre choice decided the race. */}
        {context.wet_dry_crossovers.map((lap) => (
          <line
            key={`cross-${lap}`}
            x1={x(lap)}
            x2={x(lap)}
            y1={-6}
            y2={H}
            stroke={WET}
            strokeWidth={1}
            strokeDasharray="2 3"
            strokeOpacity={0.9}
          />
        ))}

        {airs.length > 0 && (
          <path
            d={line((e) => e.air_temp_c)}
            fill="none"
            stroke="#7A8290"
            strokeWidth={1}
            strokeDasharray="3 3"
            strokeOpacity={0.7}
          />
        )}
        <path
          d={line((e) => e.track_temp_c)}
          fill="none"
          stroke="#00E5FF"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {selected?.track_temp_c != null && (
          <>
            <line
              x1={x(selected.lap)}
              x2={x(selected.lap)}
              y1={-6}
              y2={H}
              stroke="#00E5FF"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
            <circle
              cx={x(selected.lap)}
              cy={y(selected.track_temp_c)}
              r={3}
              fill="#00E5FF"
            />
          </>
        )}

        {/* Invisible per-lap hit strips, so the trace is scrubbable. */}
        {onSelectLap &&
          evo.map((e) => (
            <rect
              key={`hit-${e.lap}`}
              x={x(e.lap) - W / lapSpan / 2}
              y={-6}
              width={Math.max(3, W / lapSpan)}
              height={H + 6}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => onSelectLap(e.lap)}
            />
          ))}

        <text x={0} y={H + 14} className="mono" fill="#7A8290" fontSize={9}>
          L{minLap}
        </text>
        <text x={W} y={H + 14} textAnchor="end" className="mono" fill="#7A8290" fontSize={9}>
          L{maxLap}
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-hairline pt-2 text-[10px] text-ink-muted">
        <span>
          <span
            className="mr-1 inline-block h-[2px] w-3 align-middle"
            style={{ background: '#00E5FF' }}
            aria-hidden
          />
          track surface
        </span>
        <span>
          <span
            className="mr-1 inline-block h-[2px] w-3 align-middle"
            style={{ background: '#7A8290' }}
            aria-hidden
          />
          air
        </span>
        {wetSpans.length > 0 && (
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 align-middle"
              style={{ background: WET, opacity: 0.4 }}
              aria-hidden
            />
            rain sensor wet
          </span>
        )}
        {context.wet_dry_crossovers.length > 0 && (
          <span>
            dashed = wet/dry crossover (L{context.wet_dry_crossovers.join(', L')})
          </span>
        )}
      </div>
    </section>
  )
}
