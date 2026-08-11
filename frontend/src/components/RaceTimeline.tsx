import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Mood, Timeline, TimelinePoint } from '../types'
import { MOOD_COLOR } from '../types'

/**
 * The hero chart.
 *
 * Deliberately NOT a dual-axis chart. Pace delta (seconds) and stress index
 * (0–100) have unrelated scales, and overlaying them on two y-axes lets the
 * arbitrary scale alignment invent a correlation that isn't in the data.
 *
 * Instead: two panels stacked on a shared lap axis with a synchronised
 * crosshair. This is also strictly better for our headline claim — when the
 * two series sit vertically aligned on the same x-scale, the reader can *see*
 * the stress peak sitting to the left of the pace collapse. A dual axis would
 * have let us fake that offset, which is exactly why it isn't trustworthy.
 */

interface Props {
  timeline: Timeline
  selectedClipId: string | null
  onSelectClip: (clipId: string) => void
}

const AXIS = 'var(--axis)'
const GRID = 'var(--gridline)'
const MUTED = 'var(--text-muted)'

/** Mood markers are shape-coded as well as colour-coded: the status red/green
 *  pair fails CVD separation, so colour may never be the only channel. */
function MoodDot(props: {
  cx?: number
  cy?: number
  payload?: TimelinePoint
  selectedClipId: string | null
  onSelectClip: (id: string) => void
}) {
  const { cx, cy, payload, selectedClipId, onSelectClip } = props
  if (cx == null || cy == null || !payload?.mood || !payload.clip_id) return null

  const mood = payload.mood as Mood
  const fill = MOOD_COLOR[mood]
  const selected = payload.clip_id === selectedClipId
  const r = selected ? 7 : 5.5

  const shape =
    mood === 'Calm' ? (
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke="var(--surface-1)" strokeWidth={2} />
    ) : mood === 'Stressed' ? (
      <polygon
        points={`${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}`}
        fill={fill}
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    ) : (
      <rect
        x={cx - r}
        y={cy - r}
        width={r * 2}
        height={r * 2}
        fill={fill}
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    )

  return (
    <g
      onClick={() => onSelectClip(payload.clip_id!)}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Lap ${payload.lap}, ${mood}. Open this radio call.`}
    >
      {/* Invisible 24px hit target — the visible mark is far too small to be
          a reliable click target, especially on a projector at 3m. */}
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      {selected && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.5} />}
      {shape}
    </g>
  )
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p: TimelinePoint = payload[0].payload
  return (
    <div className="card px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-ink-primary">Lap {p.lap}</div>
      {p.delta_s != null && (
        <div className="text-ink-secondary tabular">
          Pace {p.delta_s > 0 ? '+' : ''}
          {p.delta_s.toFixed(2)}s vs clean-lap median
        </div>
      )}
      {p.stress_index != null && (
        <div className="text-ink-secondary tabular">Stress {Math.round(p.stress_index)}/100</div>
      )}
      {p.mood && (
        <div className="mt-1 font-semibold" style={{ color: MOOD_COLOR[p.mood] }}>
          {p.mood}
          <span className="ml-1 font-normal text-ink-muted">— click to open</span>
        </div>
      )}
    </div>
  )
}

/**
 * Robust y-domain for the pace panel.
 *
 * A single wet or damaged lap can be +6s while the racing variation that
 * matters lives inside ±1s. Fitting the axis to the extreme flattens the whole
 * series into a straight line and hides the signal the panel exists to show.
 *
 * So the axis is fitted to the 2nd–95th percentile and outliers are allowed to
 * overflow — but the count is reported under the chart, because silently
 * cropping data points would be worse than an unreadable axis.
 */
function robustDomain(values: number[]): { domain: [number, number]; clipped: number } {
  if (values.length < 4) return { domain: [-1, 1], clipped: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const lo = at(0.02)
  const hi = at(0.95)
  const pad = Math.max(0.15, (hi - lo) * 0.15)
  const domain: [number, number] = [
    Math.min(-0.25, Math.floor((lo - pad) * 4) / 4),
    Math.max(0.5, Math.ceil((hi + pad) * 4) / 4),
  ]
  const clipped = values.filter((v) => v < domain[0] || v > domain[1]).length
  return { domain, clipped }
}

export function RaceTimeline({ timeline, selectedClipId, onSelectClip }: Props) {
  const data = timeline.points
  const selected = timeline.clips.find((c) => c.clip_id === selectedClipId)
  const lag = timeline.lead_lag?.peak_lag_laps ?? 0
  const hasStress = data.some((p) => p.stress_index != null)

  const { domain: paceDomain, clipped } = robustDomain(
    data.map((p) => p.delta_s).filter((v): v is number => v != null),
  )

  return (
    <section className="card p-4" aria-label="Race timeline">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink-primary">
            {timeline.session.event_name} {timeline.session.year} · {timeline.driver}
          </h2>
          <p className="text-xs text-ink-muted">
            Voice stress against race pace, on a shared lap axis
          </p>
        </div>
        {/* Single series per panel, so no legend box — each panel's title names
            its series (per the accessibility pass). */}
        <div className="flex gap-4 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--series-1)' }} />
            Pace delta
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: 'var(--series-2)', opacity: 0.55 }} />
            Stress index
          </span>
        </div>
      </header>

      {/* PANEL 1 — pace delta. No x labels: the shared axis is drawn once,
          under panel 2. */}
      <p className="mb-0.5 pl-[52px] text-[10px] text-ink-muted">
        Pace delta vs clean-lap median · higher is slower
      </p>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="race" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis dataKey="lap" hide />
            {/* No rotated axis title: at this panel height it collides with the
                tick values. The signed tick format and the caption above carry
                the direction instead. */}
            <YAxis
              width={48}
              domain={paceDomain}
              allowDataOverflow
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}s`}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
            {selected?.lap != null && (
              <ReferenceLine x={selected.lap} stroke={AXIS} strokeWidth={1} />
            )}
            <Line
              type="monotone"
              dataKey="delta_s"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
              connectNulls={false}
              isAnimationActive={false}
              name="Pace delta"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* PANEL 2 — stress index, with the shared x-axis. Container height
          includes the axis band so the card never grows a nested scrollbar.
          An empty grid reads as "broken"; when there is nothing to plot the
          panel says why instead. */}
      <div className="relative h-[176px]">
        {!hasStress && (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center">
            <p className="text-xs leading-snug text-ink-muted">
              No radio calls analysed for this driver yet — the stress track stays empty until
              clips are added.
            </p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} syncId="race" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="stressFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="lap"
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
              interval={4}
              height={30}
              label={{ value: 'Lap', position: 'insideBottom', offset: 0, fill: MUTED, fontSize: 10 }}
            />
            <YAxis
              width={48}
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
            {selected?.lap != null && (
              <ReferenceLine x={selected.lap} stroke={AXIS} strokeWidth={1} />
            )}
            <Area
              type="monotone"
              dataKey="stress_index"
              stroke="var(--series-2)"
              strokeWidth={2}
              fill="url(#stressFill)"
              connectNulls
              isAnimationActive={false}
              dot={(props: any) => (
                <MoodDot
                  key={props.payload?.lap}
                  {...props}
                  selectedClipId={selectedClipId}
                  onSelectClip={onSelectClip}
                />
              )}
              activeDot={false}
              name="Stress index"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {clipped > 0 && (
        <p className="mt-1 text-[10px] text-ink-muted">
          Axis fitted to the racing range; {clipped} lap{clipped === 1 ? '' : 's'} beyond it
          (pit stop or incident) extend past the top.
        </p>
      )}

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2 text-[11px] text-ink-muted">
        <span className="flex flex-wrap items-center gap-3">
          <span>Radio calls:</span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" aria-hidden>
              <circle cx="5.5" cy="5.5" r="4.5" fill={MOOD_COLOR.Calm} />
            </svg>
            Calm
          </span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" aria-hidden>
              <polygon points="5.5,0.5 11,10.5 0,10.5" fill={MOOD_COLOR.Stressed} />
            </svg>
            Stressed
          </span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" aria-hidden>
              <rect x="0.5" y="0.5" width="10" height="10" fill={MOOD_COLOR.Tired} />
            </svg>
            Tired
          </span>
        </span>
        {lag < 0 && (
          <span className="text-ink-secondary">
            Stress peak sits {Math.abs(lag)} laps left of the pace collapse
          </span>
        )}
      </footer>
    </section>
  )
}
