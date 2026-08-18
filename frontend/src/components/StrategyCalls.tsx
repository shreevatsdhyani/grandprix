import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { humanCode } from '../lib/format'
import { URGENCY_COLOR, URGENCY_TAG } from '../lib/mood'
import type { StrategyCall, StrategyCode } from '../types'

/**
 * Where the analysis stops describing and starts instructing.
 *
 * Each row is a real <button>, not the clickable div this used to be: it drives
 * the lap selection on the chart, and a div reaches nobody on a keyboard.
 *
 * Urgency is said three ways — rail colour, tag word, and the code the headline
 * opens with. The rail is what a reader sees first and the one thing a
 * deuteranope cannot read, so it is never the only carrier.
 */

/** The claim that these calls are auditable, so it renders in every state —
 *  including the empty one, where it is the whole point. */
const FOOTNOTE =
  'Deterministic thresholds, not a language model. The same input produces the same call every time.'

/** What the threshold set can raise, most urgent first. Listed in the empty
 *  state because "nothing fired" only means something if you can see what was
 *  being watched for. */
const WATCHED: StrategyCode[] = [
  'BOX_NOW',
  'PIT_WINDOW_OPENING',
  'REDUCE_RADIO_LOAD',
  'HOLD',
  'MONITOR',
]

export function StrategyCalls({
  calls,
  onSelectLap,
}: {
  calls: StrategyCall[]
  onSelectLap: (lap: number) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)

  // Whether anything is still below the fold. A capped list with custom thin
  // scrollbars gives a reader no hint that lap 13 is not the last call, and a row
  // sheared off by the container edge reads as a rendering fault rather than as
  // more content. Tracked rather than assumed so the fade clears at the bottom of
  // the scroll instead of hanging over the final row.
  const [more, setMore] = useState(false)

  useEffect(() => {
    const el = listRef.current
    if (!el) {
      setMore(false)
      return
    }
    const update = () => setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 8)
    update()
    el.addEventListener('scroll', update, { passive: true })
    // The grid stretches this card to its sibling, so the visible height changes
    // without the call list changing at all.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [calls])

  return (
    /* The height cap is load-bearing. A busy race raises fourteen calls, and an
       uncapped list makes this card 1050px tall — which in a 1fr 1fr grid drags
       the lead-lag panel to the same height and opens 600px of dead space beside
       it. Capped, the list scrolls and the two cards stay the same size. The cap
       is above the empty state's natural height, so it never binds downwards, and
       it is set near the lead-lag panel's natural height so neither card has to
       invent filler to match the other. */
    <section
      className="panel flex h-full max-h-[480px] flex-col p-5"
      aria-label="Strategy calls"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="panel-title">What the Pit Wall Should Do</h2>
        <span className="mono text-[11px] font-normal leading-none text-t3">
          {calls.length === 0
            ? 'No calls'
            : `${calls.length} call${calls.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {calls.length === 0 ? (
        <NoCalls />
      ) : (
        // flex-1 on the list and grow on each row: this panel sits in a 1fr 1fr
        // grid, so it is stretched to whatever the sibling needs. Letting the
        // rows absorb that slack is what stops a one-call session leaving a hole
        // above the footnote. min-h-0 is what lets it shrink again inside the
        // capped card instead of pushing the footnote out of view.
        <div className="relative flex min-h-0 flex-1 flex-col">
        <ol
          ref={listRef}
          className="mt-[14px] flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto pr-1"
        >
          {calls.map((c, i) => {
            const color = URGENCY_COLOR[c.urgency]
            return (
              // Index is part of the key: the backend can emit the same code
              // twice on one lap, so lap+code is not unique.
              <li
                key={`${c.lap}-${c.code}-${i}`}
                // Grow to absorb slack, never shrink: inside the scrolling list
                // a shrink factor would squeeze fourteen rows into the visible
                // height and clip every rationale instead of scrolling.
                className="anim-rise flex flex-[1_0_auto]"
                style={{ animationDelay: `${Math.min(i, 5) * 45}ms` }}
              >
                <button
                  type="button"
                  onClick={() => onSelectLap(c.lap)}
                  title={`Show lap ${c.lap} on the race timeline`}
                  // --u carries this row's urgency colour so the hover shadow can
                  // stay a static utility: a Tailwind variant cannot take a
                  // runtime value, and hover state per row would re-render the
                  // list on every mouse move.
                  style={{ '--u': color, borderLeftColor: color } as CSSProperties}
                  className="flex w-full flex-col justify-center rounded-r-[7px] border border-l-2 border-line bg-s2 px-4 py-[14px] text-left transition-[transform,box-shadow] duration-[160ms] hover:translate-x-[2px] hover:shadow-[-6px_0_20px_-14px_var(--u)]"
                >
                  <div className="flex items-center gap-[9px]">
                    <span className="mono text-[11px] font-medium leading-none text-t3">
                      LAP {c.lap}
                    </span>
                    <span
                      className="rounded-[2px] border px-1.5 py-1 font-cond text-[9px] font-semibold leading-none tracking-[0.16em]"
                      style={{ color, borderColor: color }}
                    >
                      {URGENCY_TAG[c.urgency]}
                    </span>
                  </div>
                  <p className="mt-[10px] text-[15px] font-semibold leading-[1.3] text-t1">
                    {c.headline}
                  </p>
                  <p className="mt-[7px] text-[12.5px] leading-[1.5] text-t2">{c.rationale}</p>
                </button>
              </li>
            )
          })}
        </ol>

          {more && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
              style={{ background: 'linear-gradient(to top, var(--s1), transparent)' }}
              aria-hidden
            />
          )}
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-[1.5] text-t3">{FOOTNOTE}</p>
    </section>
  )
}

/**
 * Nothing fired.
 *
 * Sized to hold the card rather than shrink to a sentence: the sibling panel is
 * always full, and a short paragraph next to it reads as a rendering failure
 * rather than as a result. Dashed where a live call is solid, cyan because that
 * is the `info` rail — the quiet end of the same scale.
 */
function NoCalls() {
  return (
    <div
      className="anim-rise mt-[14px] flex min-h-[232px] flex-1 flex-col justify-center gap-2.5 rounded-r-[7px] border border-l-2 border-dashed border-line bg-s2 px-4 py-[14px]"
      style={{ borderLeftColor: 'var(--cyan)' }}
    >
      <span className="eyebrow">NO CALL TRIGGERED</span>
      <p className="text-[12.5px] leading-[1.5] text-t2">
        Every lap carrying a stress score was measured against the same thresholds, and none
        crossed one. Nothing to box for, nothing to flag. Silence here is a reading, not missing
        data — the thresholds ran and stayed down.
      </p>
      <div className="mt-1">
        <span className="eyebrow-sm block">CALLS THIS PANEL CAN RAISE</span>
        <p className="mono mt-2 text-[10px] leading-[1.7] text-t3">
          {WATCHED.map(humanCode).join(' · ')}
        </p>
      </div>
    </div>
  )
}
