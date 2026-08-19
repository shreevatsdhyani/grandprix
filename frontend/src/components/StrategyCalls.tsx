import type { StrategyCall, Urgency } from '../types'
import { URGENCY_COLOR } from '../types'

/**
 * Where the analysis becomes an instruction a race engineer could act on.
 *
 * The theme of the brief is "Racing Strategy & Decision-Making", so no screen
 * ends at a mood label. Status colour never carries the meaning alone — every
 * row has a glyph and the instruction in words.
 */

/** Urgency in words, so the colour of the rail is never the only signal. */
const URGENCY_WORD: Record<Urgency, string> = {
  critical: 'Act now',
  warning: 'Prepare',
  info: 'Note',
}

export function StrategyCalls({
  calls,
  onSelectLap,
}: {
  calls: StrategyCall[]
  onSelectLap?: (lap: number) => void
}) {
  return (
    <section className="panel flex flex-col p-4 sm:p-5" aria-label="Strategy calls">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">What the pit wall should do</h2>
        {calls.length > 0 && (
          <span className="mono text-[11px] text-ink-muted">
            {calls.length} call{calls.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {calls.length === 0 ? (
        <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
          Nothing triggered. No scored call crossed a threshold, so the strategy layer stays
          quiet — which is the correct output, not a missing one.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {/* Index is part of the key: the backend can emit the same code twice
              on one lap, so lap+code is not unique. */}
          {calls.map((c, i) => {
            const color = URGENCY_COLOR[c.urgency]
            return (
              <li key={`${c.lap}-${c.code}-${i}`}>
                <button
                  onClick={() => onSelectLap?.(c.lap)}
                  className="w-full overflow-hidden rounded-lg border border-hairline bg-raised text-left transition hover:border-hairline-bright"
                >
                  <div className="flex">
                    <span className="w-1 shrink-0" style={{ background: color }} aria-hidden />
                    <div className="min-w-0 flex-1 px-3 py-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="tower text-ink-muted" style={{ fontSize: 12 }}>
                          LAP {c.lap}
                        </span>
                        <span className="chip" style={{ color }}>
                          {URGENCY_WORD[c.urgency]}
                        </span>
                      </div>
                      <p
                        className="mt-1.5 text-[13px] font-semibold leading-snug"
                        style={{ color }}
                      >
                        {c.headline}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "#C5CCD6" }}>
                        {c.rationale}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-3 border-t border-hairline pt-2.5 text-[10px] leading-relaxed text-ink-muted">
        Deterministic thresholds, not a language model. The pit wall needs the same input to
        produce the same call every time.
      </p>
    </section>
  )
}
