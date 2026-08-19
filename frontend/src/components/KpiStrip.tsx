import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Verdict } from '../lib/verdict'

/**
 * The four numbers the whole page exists to produce.
 *
 * They sit in the hero's footer rather than in their own card because they are
 * the headline's receipts — read together they either support the claim above
 * them or visibly fail to, and separating them would let a reader take the claim
 * without the sample size.
 *
 * Each value counts up on arrival. That is not ornament: three of the four are
 * derived from the same timeline fetch, so without motion a driver change looks
 * identical whether the numbers changed or not.
 */

interface Props {
  verdict: Verdict
  /** Changing this replays the count — see `useReveal`. */
  resetKey: string
}

/**
 * Eased 0 → 1 over `ms`, restarting whenever `key` changes.
 *
 * `1 - (1 - p)^4` is a quartic ease-out: it covers most of the distance in the
 * first third, so the number is legible almost immediately and only the last
 * couple of digits settle. A linear ramp over the same duration reads as slow.
 *
 * Skipped entirely under `prefers-reduced-motion` — a counter is exactly the
 * kind of motion that triggers vestibular symptoms, and the final value is the
 * only part that carries information.
 */
function useReveal(ms: number, key: string): number {
  const [t, setT] = useState(0)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setT(1)
      return
    }

    let frame = 0
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const p = Math.min(1, (now - start) / ms)
      setT(1 - Math.pow(1 - p, 4))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    setT(0)
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [ms, key])

  return t
}

export function KpiStrip({ verdict, resetKey }: Props) {
  const t = useReveal(950, resetKey)
  const peak = verdict.peakStress

  return (
    /* `gap-px` over a --line ground draws the separators, so the rule always
       falls between cells whether the grid is showing two columns or four.
       Per-cell border-right needs last-in-row arithmetic that changes with the
       breakpoint, and gets it wrong at one of them. */
    <div
      className="grid grid-cols-2 gap-px border-t border-line lg:grid-cols-4"
      style={{ background: 'var(--line)' }}
    >
      <Cell
        label="Warning time"
        colour="var(--pap)"
        value={verdict.leadLaps == null ? null : String(Math.round(verdict.leadLaps * t))}
        unit={verdict.leadLaps === 1 ? 'lap' : 'laps'}
        /* A dash with a caption describing the measurement reads as data that
           failed to load. There are two different reasons this cell is empty and
           the caption has to name the one in play, because "the test ran and
           found no lead" is a result and "the sample was too small to test" is
           not. */
        caption={
          verdict.leadLaps != null
            ? 'Stress peak ahead of pace loss'
            : verdict.lagLaps == null
              ? 'No lag measurable at this sample size'
              : verdict.lagLaps === 0
                ? 'No lead — stress and pace turn on the same lap'
                : `No lead — stress follows the pace drop by ${verdict.lagLaps} ${
                    verdict.lagLaps === 1 ? 'lap' : 'laps'
                  }`
        }
      />

      <Cell
        label="Peak stress"
        colour="var(--yel)"
        value={peak == null ? null : String(Math.round(peak.value * t))}
        unit="/100"
        caption={peak ? `${peak.mood.toLowerCase()} · lap ${peak.lap}` : 'No radio scored yet'}
      />

      <Cell
        label="Strategy calls"
        colour="var(--cyan)"
        value={String(Math.round(verdict.callCount * t))}
        caption={verdict.criticalCall ?? 'No threshold crossed on any scored lap'}
      />

      <Cell
        label="Correlation"
        colour="var(--pur)"
        value={verdict.correlation == null ? null : (verdict.correlation * t).toFixed(2)}
        unit="r"
        /* "laps", not "calls": the backend counts distinct laps carrying a
           stress score, so several calls on one lap are one sample. Labelling
           these as calls would overstate the sample by a factor of two here. */
        caption={
          verdict.nSamples > 0
            ? `${verdict.nSamples} scored ${verdict.nSamples === 1 ? 'lap' : 'laps'} · ${
                verdict.significant ? 'significant' : 'indicative'
              }`
            : 'Not measurable at this sample size'
        }
      />
    </div>
  )
}

function Cell({
  label,
  colour,
  value,
  unit,
  caption,
}: {
  label: string
  colour: string
  /** null renders an em dash — a nullable metric must not read as zero. */
  value: string | null
  unit?: string
  caption: ReactNode
}) {
  const measured = value != null

  return (
    <div className="relative bg-s2 px-6 py-[18px]">
      <span
        className="absolute left-0 top-0 h-[2px] w-[38px]"
        style={{ background: measured ? colour : 'var(--line2)' }}
        aria-hidden
      />

      <p className="eyebrow">{label}</p>

      <p className="mb-2 mt-[10px] flex items-baseline gap-[7px]">
        <span
          className="readout text-[40px]"
          style={{ color: measured ? colour : 'var(--t3)' }}
        >
          {value ?? '—'}
        </span>
        {unit && measured && <span className="mono text-[13px] leading-none text-t2">{unit}</span>}
      </p>

      <p className="line-clamp-2 text-[12px] leading-[1.3] text-t3">{caption}</p>
    </div>
  )
}
