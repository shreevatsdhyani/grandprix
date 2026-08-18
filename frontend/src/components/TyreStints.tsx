import type { SessionContext, StintSummary } from '../types'

/**
 * How the tyres held up.
 *
 * The honest framing matters more here than anywhere else on the page. Real F1
 * tyre data — surface temperature, pressure, wear percentage — is measured by
 * every team and published by none. There is no API for it. Everything in this
 * panel is inferred from three things F1 does publish: which compound, how many
 * laps old, and what the lap times did.
 *
 * So the degradation figure is labelled as modelled every time it appears, and the
 * footnote says why. A dashboard that showed a confident tyre temperature here
 * would be inventing it.
 *
 * Bars are sized by stint length and coloured by Pirelli's own compound palette,
 * which the audience already reads fluently — with the compound named on the bar,
 * so the colour is never the only signal.
 */

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: '#FF3333',
  MEDIUM: '#FFD12E',
  HARD: '#EDEDED',
  INTERMEDIATE: '#43B02A',
  WET: '#0067AD',
}

const LIGHT_COMPOUNDS = new Set(['HARD', 'MEDIUM'])

function compoundColor(c: string | null) {
  return COMPOUND_COLOR[(c ?? '').toUpperCase()] ?? '#7A8290'
}

/**
 * How to read a degradation slope.
 *
 * Fuel burn works against tyre wear — a car gets roughly 0.03s/lap faster as it
 * empties — so a flat slope already means mild degradation, and a negative one on
 * a long stint is normal rather than a tyre improving. The wording reflects that
 * rather than treating zero as neutral.
 */
function degWord(slope: number | null): { text: string; tone: string } {
  if (slope == null) return { text: 'too short to model', tone: 'text-ink-muted' }
  if (slope >= 0.15) return { text: 'dropping off', tone: 'text-status-warning' }
  if (slope >= 0.05) return { text: 'wearing steadily', tone: 'text-ink-secondary' }
  if (slope >= -0.05) return { text: 'holding on', tone: 'text-ink-secondary' }
  return { text: 'gaining pace', tone: 'text-status-good' }
}

export function TyreStints({
  context,
  driver,
  onSelectLap,
}: {
  context: SessionContext | null
  driver: string
  onSelectLap?: (lap: number) => void
}) {
  const stints: StintSummary[] = context?.stints_by_driver[driver.toUpperCase()] ?? []

  if (stints.length === 0) {
    return (
      <section className="panel p-4 sm:p-5" aria-label="Tyre stints">
        <h2 className="card-title">Tyre stints</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          No stint data for {driver} in this session.
        </p>
      </section>
    )
  }

  const totalLaps = stints.reduce((n, s) => n + s.n_laps, 0)

  return (
    <section className="panel p-4 sm:p-5" aria-label="Tyre stints">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">Tyre stints</h2>
        <span className="mono text-[10px] text-ink-muted">
          {stints.length} stint{stints.length === 1 ? '' : 's'} · {totalLaps} laps
        </span>
      </div>

      {/* One proportional bar: the shape of the race strategy at a glance. */}
      <div className="mt-3 flex h-[22px] overflow-hidden rounded">
        {stints.map((s) => {
          const share = (s.n_laps / totalLaps) * 100
          return (
            <button
              key={s.stint_number}
              onClick={() => onSelectLap?.(s.lap_start)}
              className="flex items-center justify-center overflow-hidden transition hover:brightness-110"
              style={{ width: `${share}%`, background: compoundColor(s.compound), opacity: 0.9 }}
              title={`${s.compound}: laps ${s.lap_start}–${s.lap_end}`}
              aria-label={`Stint ${s.stint_number}, ${s.compound}, laps ${s.lap_start} to ${s.lap_end}`}
            >
              {share > 12 && (
                <span
                  className="mono truncate px-1 text-[9px] font-semibold uppercase"
                  style={{
                    color: LIGHT_COMPOUNDS.has((s.compound ?? '').toUpperCase())
                      ? '#07080b'
                      : '#fff',
                  }}
                >
                  {s.compound}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <ul className="mt-3 space-y-2">
        {stints.map((s) => {
          const deg = degWord(s.deg_slope_s_per_lap)
          return (
            <li key={s.stint_number} className="flex items-start gap-2.5">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: compoundColor(s.compound) }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="mono text-[12px] text-ink">{s.compound ?? 'unknown'}</span>
                  <button
                    onClick={() => onSelectLap?.(s.lap_start)}
                    className="mono tabular text-[11px] text-ink-muted underline decoration-dotted transition hover:text-ink"
                  >
                    L{s.lap_start}–{s.lap_end}
                  </button>
                  <span className="mono tabular text-[11px] text-ink-muted">
                    {s.n_laps} laps
                  </span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[11px] ${deg.tone}`}>{deg.text}</span>
                  {s.deg_slope_s_per_lap != null && (
                    <span className="mono tabular text-[10px] text-ink-muted">
                      {s.deg_slope_s_per_lap >= 0 ? '+' : ''}
                      {s.deg_slope_s_per_lap.toFixed(3)} s/lap modelled
                    </span>
                  )}
                  {s.best_lap_s != null && (
                    <span className="mono tabular text-[10px] text-ink-muted">
                      best {s.best_lap_s.toFixed(3)}s
                    </span>
                  )}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 border-t border-hairline pt-2 text-[10px] leading-relaxed text-ink-muted">
        Degradation is <span className="mono">modelled</span> from compound, tyre age and lap-time
        trend on green laps. Tyre temperature, pressure and wear are not published by any team, so
        nothing here is measured off the tyre.
      </p>
    </section>
  )
}
