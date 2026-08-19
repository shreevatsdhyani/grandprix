import type { ReactNode } from 'react'
import { CircuitMap } from './CircuitMap'
import { DriverPlate } from './DriverPlate'
import { KpiStrip } from './KpiStrip'
import { tint } from '../lib/mood'
import type { Circuit } from '../lib/circuits'
import type { Driver } from '../lib/drivers'
import type { Verdict } from '../lib/verdict'

/**
 * The answer, before the evidence.
 *
 * Every version of this dashboard before it opened with two charts and left the
 * reader to work out what they meant. The charts were the same charts; what was
 * missing was a sentence. So the finding goes first, at display size, with the
 * number that carries it pulled out in papaya — and everything below this card
 * becomes evidence for a claim the reader has already read rather than a puzzle.
 *
 * Nothing here is invented. The headline, the support line and the hedge all
 * come from `readVerdict`, which derives them from the backend's own lead-lag
 * peak and carries `is_significant` through untouched.
 */

interface Props {
  verdict: Verdict
  driver: Driver
  circuit: Circuit | null
  /** Changing this replays the KPI count-up — pass session + driver + mode. */
  resetKey: string
}

export function VerdictHero({ verdict, driver, circuit, resetKey }: Props) {
  return (
    <section className="panel mt-4 overflow-hidden" aria-label="The finding">
      <div className="relative grid grid-cols-1 gap-8 p-6 md:grid-cols-[336px_1fr]">
        {circuit && <CircuitMap circuit={circuit} />}

        <div className="relative z-[1] min-w-0">
          <DriverPlate driver={driver} />
        </div>

        <div className="relative z-[1] flex min-w-0 flex-col gap-3.5 pt-0.5">
          <p className="flex items-center gap-2.5">
            <span className="h-[2px] w-[18px] flex-none bg-pap" aria-hidden />
            <span className="font-cond text-[9.5px] font-semibold uppercase leading-none tracking-[0.22em] text-t3">
              The finding
            </span>
          </p>

          <h1 className="display max-w-[760px] text-pretty text-[32px] leading-[1.04] sm:text-[40px] xl:text-[46px]">
            {headline(verdict)}
          </h1>

          <p className="max-w-[620px] text-pretty text-[15px] leading-[1.55] text-t2">
            {verdict.support}
          </p>

          {hedge(verdict) && (
            /* The same yellow recipe appears on the lead-lag panel. Two places is
               deliberate: a reader who only takes the headline still gets the
               qualifier, and one who only reads the chart gets it there. */
            <div
              className="flex max-w-[660px] items-start gap-[9px] rounded-r-[5px] border-l-2 px-3 py-2.5"
              style={{
                background: tint('var(--yel)', 7),
                borderLeftColor: 'var(--yel)',
              }}
            >
              <span className="text-[11px] leading-[1.4] text-yel" aria-hidden>
                ▲
              </span>
              <p className="text-[12px] leading-[1.45] text-yel">{hedge(verdict)}</p>
            </div>
          )}
        </div>
      </div>

      <KpiStrip verdict={verdict} resetKey={resetKey} />
    </section>
  )
}

/**
 * The headline with its lead figure pulled out.
 *
 * `verdict.headline` is the same sentence as plain text, and it stays the
 * canonical version — this only decides which token in it is the number. Parsing
 * the digits back out of that string would break the first time the copy
 * changed, so the shapes are composed per state instead.
 */
function headline(v: Verdict): ReactNode {
  if (v.state === 'lead' && v.leadLaps != null) {
    return (
      <>
        The voice cracked <Figure>{v.leadLaps}</Figure> {v.leadLaps === 1 ? 'lap' : 'laps'} before
        the stopwatch
      </>
    )
  }

  if (v.state === 'no-lead' && v.peakStress) {
    return (
      <>
        Peak stress <Figure>{Math.round(v.peakStress.value)}</Figure> on lap {v.peakStress.lap}
      </>
    )
  }

  return v.headline
}

function Figure({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono text-[30px] font-bold leading-none text-pap sm:text-[38px] xl:text-[44px]"
      style={{ textShadow: `0 0 24px ${tint('var(--pap)', 45)}` }}
    >
      {children}
    </span>
  )
}

/**
 * What the claim above cannot support, in the reader's terms.
 *
 * `is_significant` is false for nearly every driver in this dataset, because the
 * backend counts distinct laps carrying a stress score against a floor of 25 and
 * several calls on one lap collapse to one sample. So this hedge is the normal
 * state, not an exception — which is why it is styled as a designed qualifier
 * rather than as a warning that something went wrong.
 *
 * Returns null when there is nothing measured to qualify: the support line
 * already says so, and stacking a caveat on top of "no radio scored yet" reads
 * as two different problems.
 */
function hedge(v: Verdict): string | null {
  if (v.significant || v.nSamples === 0) return null

  const laps = `${v.nSamples} scored ${v.nSamples === 1 ? 'lap' : 'laps'}`

  if (v.state === 'lead') {
    return `Measured across ${laps}, below the 25 this test needs to call it significant. Read the gap as directional — the shape is there, the sample is not yet.`
  }

  return `Measured across ${laps}. Below the 25-lap floor the correlation is indicative only, so absence of a lead here is not evidence against one.`
}
