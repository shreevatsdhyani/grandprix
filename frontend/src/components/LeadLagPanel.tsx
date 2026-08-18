import type { ReactNode } from 'react'
import { clamp } from '../lib/format'
import { tint } from '../lib/mood'
import type { LeadLagAnalysis } from '../types'

/**
 * The one panel that tests a relationship rather than reporting a value: does
 * voice stress move before the pace does, or after it?
 *
 * Correlation against a signed lag axis is ordered magnitude on a discrete
 * domain, so it is bars around a zero rule, not a line — the individual offsets
 * are the reading, and a line between them would imply values that were never
 * measured.
 *
 * Three states, all of which are normal here: a measured curve, a measured curve
 * the sample is too small to promote to a finding, and no measurable curve at
 * all. The last two are the common ones on ~100 clips, so neither is allowed to
 * look like a fault.
 */

/** Mirrors config.MIN_PAIRS. Below four pairs the backend reports `null`, never
 *  `0.00`, and this panel has to keep that distinction visible. */
const MIN_PAIRS = 4

/** Mirrors config.MIN_SAMPLES_FOR_SIGNIFICANCE. Named in the caveat copy so the
 *  hedge tells a reader what would lift it, not just that it exists. */
const SIGNIFICANCE_FLOOR = 25

/** config.LEAD_LAG_RANGE. Drawn even with nothing to plot, so the empty state
 *  shows the shape of the answer instead of a blank column. */
const LAG_RANGE = [-4, -3, -2, -1, 0, 1, 2, 3, 4]

/** U+2212. A hyphen sets too short and too high to read as a sign next to
 *  tabular figures. */
const signed = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : `${n}`)

/** Same minus, plus a guard: a coefficient of -0.001 rounds to 0.00, and
 *  "−0.00" claims a direction the number does not have. */
const rText = (v: number): string => {
  const mag = Math.abs(v).toFixed(2)
  return v < 0 && mag !== '0.00' ? `−${mag}` : mag
}

const lapWord = (n: number): string => (Math.abs(n) === 1 ? 'lap' : 'laps')

const pairWord = (n: number): string => `${n} pair${n === 1 ? '' : 's'}`

/** Geometry lands on floats — 0.28 × 40 is 11.200000000000001 — and the raw
 *  value would go straight into the attribute. */
const px = (v: number): number => Math.round(v * 100) / 100

/** One slot on the lag axis. `r` and `pairs` are both nullable because an
 *  unmeasured offset has no coefficient, and the null-analysis state has no pair
 *  count either — inventing a 0 for the second would be the same lie as
 *  inventing one for the first. */
type Slot = { lag: number; r: number | null; pairs: number | null }

export function LeadLagPanel({
  analysis,
  nClips,
}: {
  analysis: LeadLagAnalysis | null
  nClips: number
}) {
  if (!analysis) return <NoCurve nClips={nClips} />

  /* Three answers, not two.

     A single `leads` boolean folded "the voice moves with the stopwatch" and
     "the voice trails it by three laps" into one branch, and printed the first
     for both — directly above the backend's own sentence saying the second. The
     panel contradicted itself on every session where the pace moves first,
     which on this dataset is most of them. */
  const lag = analysis.peak_lag_laps
  const laps = Math.abs(lag)
  const slots: Slot[] = analysis.curve.map((p) => ({
    lag: p.lag_laps,
    r: p.correlation,
    pairs: p.n_pairs,
  }))

  return (
    <section className="panel flex h-full flex-col p-5" aria-label="Lead-lag analysis">
      <Head n={analysis.n_samples} />

      <div className="mt-[14px] grid flex-1 grid-cols-[auto_1fr] items-center gap-6">
        <Figure
          value={`${laps}`}
          /* Papaya is the app's "this is the finding" colour, so a trailing
             voice — which is the absence of the finding — gets body weight
             instead. The figure still fills the column either way. */
          tone={lag > 0 ? 'text-t2' : 'text-pap'}
          unit={lapWord(laps)}
          note={
            lag < 0 ? (
              <>
                earlier than
                <br />
                the pace drop
              </>
            ) : lag > 0 ? (
              <>
                behind the pace drop —
                <br />
                the voice reacts to it
              </>
            ) : (
              <>
                of lead — the voice
                <br />
                moves with the stopwatch
              </>
            )
          }
        />
        <div>
          <LagChart slots={slots} peakLag={analysis.peak_lag_laps} />
          <AxisNote />
        </div>
      </div>

      {/* Verbatim. The backend writes this sentence from the numbers it just
          computed; paraphrasing it here is how the two drift apart. */}
      <p className="mt-[14px] text-[12.5px] leading-[1.5] text-t2">{analysis.interpretation}</p>

      {!analysis.is_significant && (
        <Caveat>
          {analysis.n_samples < SIGNIFICANCE_FLOOR
            ? `Read this as a direction, not a result. It rests on ${analysis.n_samples} distinct scored ${lapWord(analysis.n_samples)} — several radio calls on one lap count once — against the ${SIGNIFICANCE_FLOOR} this test asks for before it will call a lead real.`
            : `Read this as a direction, not a result. The sample clears the ${SIGNIFICANCE_FLOOR}-lap floor, but no offset returns a positive correlation, so there is no lead here to claim.`}
        </Caveat>
      )}
    </section>
  )
}

/**
 * No offset cleared the pair floor, so there is no curve.
 *
 * Same head row, same two-column body, same axis furniture — the card keeps its
 * shape and its weight next to a full sibling, and the reader gets to see where
 * the bars would land. A blank half-panel would say less and look broken.
 */
function NoCurve({ nClips }: { nClips: number }) {
  const slots: Slot[] = LAG_RANGE.map((lag) => ({ lag, r: null, pairs: null }))
  const clips =
    nClips === 0 ? 'no scored calls' : nClips === 1 ? '1 scored call' : `${nClips} scored calls`

  return (
    <section className="panel flex h-full flex-col p-5" aria-label="Lead-lag analysis">
      <Head n={null} />

      <div className="mt-[14px] grid flex-1 grid-cols-[auto_1fr] items-center gap-6">
        <Figure
          value="—"
          tone="text-t3"
          unit="not measured"
          note={
            <>
              no offset cleared
              <br />
              the four-pair floor
            </>
          }
        />
        <div>
          <LagChart slots={slots} peakLag={null} />
          <AxisNote />
        </div>
      </div>

      <p className="mt-[14px] text-[12.5px] leading-[1.5] text-t2">
        With {clips} in this session, no offset between −4 and +4 laps reached the four paired laps
        a correlation needs. Several calls can land on the same lap, and only clean laps carry a
        usable pace delta, so the pairs run out early. The slots above mark where each bar will sit
        once they fill.
      </p>

      <Caveat>
        No coefficient is reported at any offset, so there is nothing here yet to read as a
        finding. {MIN_PAIRS} paired laps at one offset is the floor; the first session that clears
        it draws this chart in.
      </Caveat>
    </section>
  )
}

function Head({ n }: { n: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="panel-title">Does the Voice Lead the Stopwatch?</h2>
      <span className="mono text-[11px] font-normal leading-none text-t3">n = {n ?? '—'}</span>
    </div>
  )
}

/** The headline number. Baseline-aligned to the unit so the figure and the word
 *  sit on one line, which is what makes "3 laps earlier" read as a sentence. */
function Figure({
  value,
  tone,
  unit,
  note,
}: {
  value: string
  tone: string
  unit: string
  note: ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`readout text-[52px] ${tone}`}>{value}</span>
      <span className="block">
        <span className="block text-[13px] leading-none text-t2">{unit}</span>
        <span className="mt-1 block text-[12px] leading-[1.3] text-t3">{note}</span>
      </span>
    </div>
  )
}

function AxisNote() {
  return (
    <div className="mt-1.5 flex justify-center text-center text-[10.5px] leading-none text-t3">
      ← voice first · lag (laps) · pace first →
    </div>
  )
}

/**
 * The yellow hedge, third of three uses across the app.
 *
 * The wash is `tint()` rather than an rgba literal: --yel is re-picked to
 * #B98A00 in PIT LANE, and a hardcoded wash would keep the dark theme's hue on a
 * white card.
 */
function Caveat({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-2.5 flex items-start gap-[9px] rounded-r-[5px] border-l-2 border-yel px-3 py-2.5"
      style={{ background: tint('var(--yel)', 7) }}
    >
      <span aria-hidden className="text-[11px] leading-[1.4] text-yel">
        ▲
      </span>
      <span className="text-[12px] leading-[1.45] text-yel">{children}</span>
    </div>
  )
}

/* Chart frame. Taller than the mockup's 120 because the viewBox scales by width:
   a 380×200 box at the same column width renders 200px tall instead of 120, which
   is what turns a row of 9px stubs into bars with a readable shape — and it also
   takes up height this card would otherwise leave blank next to a full sibling. */
const CH_ZERO = 100
const CH_HALF = 76

/* Horizontal frame. The gutter is 38 rather than the mockup's 18 because a fitted
   axis label is "−0.25", not "−1": five characters of 9.5px mono need ~29 units,
   and anchored at the old x=14 they ran off the left of the viewBox and were
   clipped away. The bar row is narrowed by the same amount so nothing shifts
   into the right margin. */
const CH_L = 38
const CH_R = 372
const CH_BARS_X = 42
const CH_SPAN = 288

/** Candidate axis ranges, smallest first. A fixed ±1 axis is the honest default
 *  and completely unreadable on real data: voice-to-pace correlations here peak
 *  around 0.24, which is a 9px bar in a 40px half-height. */
const R_STEPS = [0.1, 0.25, 0.5, 1]

/** The axis range's own label. It is printed on the chart, so fitting the range to
 *  the data costs no honesty — the reader can see what the top gridline means. */
const axisLabel = (v: number): string => {
  const mag = Math.abs(v) === 1 ? '1' : Math.abs(v).toFixed(2)
  return v < 0 ? `−${mag}` : mag
}

/**
 * The lag curve, hand-drawn.
 *
 * Geometry is fixed in a 380×200 viewBox and scaled by width, so the bars keep
 * their proportions in either column width without a measure-and-relayout pass.
 *
 * The y range is fitted to the largest coefficient present rather than pinned to
 * ±1, and the gridlines are labelled with whatever range that picked. Exact values
 * stay recoverable on hover, so nothing is lost by not showing the full ±1 box —
 * and the shape of the curve, which is the actual reading, becomes visible.
 *
 * The highlight is derived from `lag_laps === peakLag`, never from an index: the
 * mockup hardcoded slot 3 and that is only the peak for one shape of curve.
 */
function LagChart({ slots, peakLag }: { slots: Slot[]; peakLag: number | null }) {
  const n = slots.length
  const pitch = n > 1 ? CH_SPAN / (n - 1) : 0
  const barW = Math.min(26, Math.max(6, pitch - 8))
  // Hover targets are full-height columns. An unmeasured slot's mark is one pixel
  // tall, and a 1px target is not a target.
  const hitW = Math.max(barW, Math.min(pitch || 34, 34))

  const measured = slots.map((s) => s.r).filter((r): r is number => r != null)
  const maxAbs = measured.length > 0 ? Math.max(...measured.map(Math.abs)) : 0
  // Nothing measured: keep the textbook ±1 rather than label an empty chart with a
  // range fitted to no data.
  const scale = measured.length === 0 ? 1 : (R_STEPS.find((s) => maxAbs <= s + 1e-9) ?? 1)

  return (
    <svg
      viewBox="0 0 380 200"
      className="block h-auto w-full"
      role="img"
      aria-label={`Voice-stress to pace correlation at lag offsets from minus four to plus four laps, on an axis of plus or minus ${axisLabel(scale)}`}
    >
      <line x1={CH_L} y1={CH_ZERO} x2={CH_R} y2={CH_ZERO} stroke="var(--line2)" strokeWidth="1" />
      {[CH_ZERO - CH_HALF, CH_ZERO + CH_HALF].map((y) => (
        <line
          key={y}
          x1={CH_L}
          y1={y}
          x2={CH_R}
          y2={y}
          stroke="var(--grid)"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
      ))}

      {[
        { label: axisLabel(scale), y: CH_ZERO - CH_HALF + 3 },
        { label: '0', y: CH_ZERO + 3 },
        { label: axisLabel(-scale), y: CH_ZERO + CH_HALF + 3 },
      ].map((tick) => (
        <text
          key={tick.label}
          x={CH_L - 4}
          y={tick.y}
          textAnchor="end"
          fill="var(--t3)"
          fontFamily="Roboto Mono, monospace"
          fontSize="9.5"
        >
          {tick.label}
        </text>
      ))}

      {slots.map((s, i) => {
        const cx = CH_BARS_X + i * pitch + barW / 2
        const r = s.r
        // clamp guards the box: a coefficient past the fitted range would draw
        // straight through the gridlines rather than fail visibly.
        const mag = r == null ? 0 : clamp(Math.abs(r) / scale, 0, 1) * CH_HALF
        return (
          <g key={s.lag} style={{ animation: 'gp-fin .4s .3s both' }}>
            <title>{slotTitle(s)}</title>
            <rect
              x={px(cx - hitW / 2)}
              y="10"
              width={px(hitW)}
              height={CH_ZERO + CH_HALF + 4 - 10}
              fill="none"
              pointerEvents="all"
            />
            {r == null ? (
              // A dash, not a zero-height bar: an empty slot must not read as
              // r = 0.00, which is exactly what the backend refused to report.
              <rect x={px(cx - 3)} y={CH_ZERO - 0.5} width="6" height="1" fill="var(--line2)" />
            ) : (
              <rect
                x={px(cx - barW / 2)}
                y={px(r >= 0 ? CH_ZERO - mag : CH_ZERO)}
                width={px(barW)}
                height={px(Math.max(2, mag))}
                rx="1"
                fill={s.lag === peakLag ? 'var(--pap)' : 'var(--cyan)'}
              />
            )}
          </g>
        )
      })}

      {slots.map((s, i) => (
        <text
          key={s.lag}
          x={px(CH_BARS_X + i * pitch + barW / 2)}
          y={CH_ZERO + CH_HALF + 19}
          textAnchor="middle"
          fill="var(--t3)"
          fontFamily="Roboto Mono, monospace"
          fontSize="9.5"
        >
          {signed(s.lag)}
        </text>
      ))}
    </svg>
  )
}

/** Hover text, so the exact value behind a 40px-tall bar is recoverable. */
function slotTitle(s: Slot): string {
  const where = `lag ${signed(s.lag)} ${lapWord(s.lag)}`
  const pairs = s.pairs == null ? null : pairWord(s.pairs)
  if (s.r == null) {
    return pairs == null
      ? `${where} · not measured`
      : `${where} · not measured · ${pairs}, under the ${MIN_PAIRS}-pair floor`
  }
  const value = `${where} · r = ${rText(s.r)}`
  return pairs == null ? value : `${value} · ${pairs}`
}
