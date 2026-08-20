import type { Mood, MoodResult } from '../types'
import { MOOD_COLOR } from '../types'

/**
 * One band, one arrow: where this call landed against the baseline.
 *
 * Three fixed zones, and the arrow sits in the zone of the winning mood — so it
 * can never point somewhere the mood chip disagrees with. Its position *inside*
 * the zone is the margin over the runner-up: on the shared divider when the top
 * two were nearly tied, out toward the far side when the call was clear-cut.
 *
 * The obvious alternative was to slide the arrow by stress index, and it does
 * not work: `stress_index` is `100 * (P(stressed) + 0.9 * P(tired))`
 * (fusion.py:216), so Tired and Stressed both push it high and a reading of 60
 * could be either one. The arrow would land in amber while the verdict above it
 * said Tired. The probabilities are what the label is actually argmax'd from
 * (fusion.py:223), so they are what the band is drawn from.
 */

/** Left to right, as sketched. Also the order the colours were chosen in. */
const ZONES: Mood[] = ['Calm', 'Tired', 'Stressed']

/** Margin over the runner-up that counts as fully decided. Beyond this the
 *  arrow has run out of zone to travel through, so it stops moving. */
const DECIDED = 0.45

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Arrow position as a percentage across the whole band.
 *
 * Held apart from the render because it is the only real logic here and it is
 * the bit worth being able to read in one piece.
 */
function arrowPct(result: MoodResult): number {
  const wi = Math.max(0, ZONES.indexOf(result.mood))
  const win = result.probabilities[result.mood] ?? 0

  // Runner-up, and which side of the winning zone it lies on. Not necessarily
  // adjacent — Calm can be chased by Stressed — but the direction still reads
  // correctly, because the zone edge nearest the challenger is the one the
  // arrow should crowd.
  let ru = 0
  let rui = wi
  ZONES.forEach((m, i) => {
    const p = result.probabilities[m] ?? 0
    if (i !== wi && p > ru) {
      ru = p
      rui = i
    }
  })

  const w = 100 / ZONES.length
  const start = wi * w
  const towardRight = rui > wi

  const near = towardRight ? start + w : start
  const far = towardRight ? start + w * 0.18 : start + w * 0.82
  const decided = clamp((win - ru) / DECIDED, 0, 1)

  // A hair inside the band's own rounded ends, so a decisive Calm or Stressed
  // reading does not have its arrowhead clipped by the corner radius.
  return clamp(near + (far - near) * decided, 2.5, 97.5)
}

export function BaselineBand({ result }: { result: MoodResult | null }) {
  const pct = result ? arrowPct(result) : 50
  const color = result ? MOOD_COLOR[result.mood] : 'var(--slate)'

  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">Baseline features</h3>
        {result && (
          <p className="mono text-[11px] leading-none" style={{ color }}>
            {result.mood.toUpperCase()}
            <span className="text-ink-muted">
              {' '}
              {Math.round((result.probabilities[result.mood] ?? 0) * 100)}%
            </span>
          </p>
        )}
      </div>

      <div
        // `group` so hovering anywhere on the band reveals all three readings at
        // once. Per-zone hover would mean three passes to compare three numbers,
        // and comparing them is the entire reason to want them.
        className="group mt-2.5 flex h-[30px] overflow-hidden rounded-[8px] border border-hairline bg-raised"
        role="img"
        aria-label={
          result
            ? `${result.mood}, from ${ZONES.map((m) => `${m} ${Math.round((result.probabilities[m] ?? 0) * 100)} percent`).join(', ')}`
            : 'No call selected'
        }
      >
        {ZONES.map((m) => {
          const on = result?.mood === m
          const pct = Math.round((result?.probabilities[m] ?? 0) * 100)
          return (
            <div
              key={m}
              // Dividers are drawn as a left border on the two later zones, so
              // they land exactly on the boundary the arrow can come to rest on.
              className={`relative flex flex-1 items-center justify-center ${
                m === 'Calm' ? '' : 'border-l border-hairline'
              }`}
              style={{
                background: `color-mix(in srgb, ${MOOD_COLOR[m]} ${on ? 26 : 8}%, transparent)`,
              }}
              // Carries the same number where hover does not exist, and on a
              // zone too narrow to print it into.
              title={result ? `${m} ${pct}%` : undefined}
            >
              <span
                className="tower text-[12px]"
                style={{ color: MOOD_COLOR[m], opacity: on ? 1 : 0.55 }}
              >
                {m.toUpperCase()}
              </span>
              {/* Parked against the zone's right edge rather than beside the
                  label, so revealing it moves nothing. Pointer-only: below `sm`
                  the zone is too narrow to hold both, and a touch screen has no
                  hover to trigger it with anyway. */}
              {result && (
                <span
                  className="mono absolute right-2 hidden text-[10px] leading-none opacity-0 transition-opacity duration-150 group-hover:opacity-100 sm:block"
                  style={{ color: MOOD_COLOR[m] }}
                  aria-hidden
                >
                  {pct}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* The sketch's arrow, under the band pointing up at it. Kept outside the
          band rather than inside so it never sits on top of a zone label. */}
      <div className="relative h-[13px]">
        {result && (
          <span
            className="absolute top-0 -translate-x-1/2 transition-[left] duration-500"
            style={{ left: `${pct}%` }}
            aria-hidden
          >
            <span
              className="block"
              style={{
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderBottom: `6px solid ${color}`,
                filter: `drop-shadow(0 0 5px ${color})`,
              }}
            />
            <span
              className="mx-auto block h-[6px] w-[2px] rounded-full"
              style={{ background: color }}
            />
          </span>
        )}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">
        {result
          ? 'The arrow marks this call. It crowds a divider when the top two readings were close, and sits deep in a zone when the call was clear-cut.'
          : 'Open a radio call to see where it landed.'}
      </p>
    </div>
  )
}
