import { flagToCode } from '../lib/format'
import type { Circuit } from '../lib/circuits'
import type { ModelCard, ScoringMode, SessionMeta } from '../types'

/**
 * The 48px bar that says which race you are looking at and what scored it.
 *
 * It exists because the header's pickers say *what is selected* but not *what
 * that is* — a reader who has never heard of Marina Bay learns nothing from the
 * word "Singapore". Lap count, length and corner count are the three numbers
 * that make the charts below legible, so they sit above them rather than in a
 * tooltip.
 */

interface Props {
  session: SessionMeta | null
  circuit: Circuit | null
  mode: ScoringMode
  modelCard: ModelCard | null
}

export function SessionBanner({ session, circuit, mode, modelCard }: Props) {
  const code = flagToCode(circuit?.flag)

  // Leading with the year is not decoration: Monaco and Singapore each appear
  // twice in the cached set, so the event name alone does not identify the race.
  const meta = session
    ? [
        String(session.year),
        circuit?.location,
        circuit && `${circuit.laps} LAPS`,
        circuit && `${circuit.km.toFixed(3)} KM`,
        circuit && `${circuit.turns} TURNS`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <section
      className="mt-4 flex min-h-[48px] items-stretch justify-between gap-4 overflow-hidden rounded-md border border-line bg-s1 pr-[18px] shadow-panel"
      aria-label="Session"
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-3.5">
        <div className="hatch w-[26px] flex-none opacity-90" aria-hidden />

        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 py-2">
          {code && (
            <span className="mono flex-none rounded-[2px] border border-line bg-glass px-[5px] py-1 text-[9px] font-bold leading-none text-t2">
              {code}
            </span>
          )}

          <h2 className="min-w-0 truncate font-cond text-[19px] font-bold uppercase leading-none tracking-[0.1em] text-t1">
            {session?.event_name ?? 'No race selected'}
          </h2>

          {meta && (
            <>
              <span className="hidden h-[18px] w-px flex-none bg-line2 sm:block" aria-hidden />
              <p className="mono min-w-0 truncate text-[11.5px] leading-none tracking-[0.02em] text-t3">
                {meta}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center py-2">
        <span
          className="notch-sm whitespace-nowrap border border-pap px-3.5 py-[7px] font-cond text-[10px] font-semibold uppercase leading-none tracking-[0.18em] text-pap"
          style={{ background: 'color-mix(in srgb, var(--pap) 9%, transparent)' }}
          title={
            modelCard
              ? `Fitted on ${modelCard.n_train} labelled clips · ${modelCard.features.length} features · cross-validated`
              : 'The fusion head has not been fitted on this machine'
          }
        >
          {/* The accuracy is read from the fitted head's own scorecard, so the
              number on screen is the one the model was actually fitted at. A
              hardcoded label goes stale the next time the head is refitted. */}
          {modelCard
            ? mode === 'fusion'
              ? `Fusion · ${(modelCard.cv_accuracy * 100).toFixed(1)}%`
              : `Single · ${(modelCard.naive_accuracy * 100).toFixed(1)}%`
            : mode === 'fusion'
              ? 'Fusion scoring'
              : 'Single model'}
        </span>
      </div>
    </section>
  )
}
