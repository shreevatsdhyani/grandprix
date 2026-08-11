import type { StrategyCall } from '../types'
import { URGENCY_COLOR } from '../types'

/**
 * The theme of the brief is "Racing Strategy & Decision-Making", so no screen
 * ends at a mood label. This panel is where the analysis becomes an instruction
 * a race engineer could actually act on.
 *
 * Status colour never carries the meaning alone — every row has an icon and the
 * instruction in words.
 */

const ICON: Record<string, string> = {
  BOX_NOW: '▼',
  PIT_WINDOW_OPENING: '◆',
  HOLD: '■',
  REDUCE_RADIO_LOAD: '≡',
  MONITOR: '·',
}

export function StrategyCalls({ calls, onSelectLap }: { calls: StrategyCall[]; onSelectLap?: (lap: number) => void }) {
  return (
    <section className="card flex flex-col p-4" aria-label="Strategy calls">
      <h2 className="card-title mb-3">Strategy calls</h2>

      {calls.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No calls triggered. The single-model baseline detects no fatigue, so the strategy
          layer has nothing to fire on.
        </p>
      ) : (
        <ol className="space-y-2">
          {calls.map((c) => {
            const color = URGENCY_COLOR[c.urgency]
            return (
              <li key={`${c.lap}-${c.code}`}>
                <button
                  onClick={() => onSelectLap?.(c.lap)}
                  className="w-full rounded border border-hairline bg-raised px-3 py-2 text-left transition hover:border-ink-muted"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-[11px] text-ink-muted">L{c.lap}</span>
                    <span aria-hidden style={{ color }}>
                      {ICON[c.code] ?? '·'}
                    </span>
                    <span className="text-xs font-semibold leading-snug" style={{ color }}>
                      {c.headline}
                    </span>
                  </div>
                  <p className="mt-1 pl-7 text-[11px] leading-snug text-ink-muted">{c.rationale}</p>
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-3 border-t border-hairline pt-2 text-[10px] leading-tight text-ink-muted">
        Deterministic thresholds, not a language model — the pit wall needs the same input to
        produce the same call every time.
      </p>
    </section>
  )
}
