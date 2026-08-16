import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Verdict } from '../lib/verdict'
import type { Mood, Timeline, TimelinePoint } from '../types'
import { MOOD_COLOR } from '../types'

/**
 * The evidence for the verdict above.
 *
 * Deliberately NOT a dual-axis chart. Pace delta (seconds) and stress index
 * (0–100) have unrelated scales, and overlaying them on two y-axes lets the
 * arbitrary scale alignment invent a correlation that isn't in the data.
 *
 * Instead: two panels stacked on the same lap scale with a synchronised
 * crosshair. That is also strictly better for the headline claim — vertically
 * aligned on one x-scale, the reader can *see* the stress peak sitting left of
 * the pace collapse. A dual axis would have let us fake that offset, which is
 * exactly why it isn't trustworthy.
 *
 * The warning band is the one piece of chart furniture that is an argument
 * rather than a reading: a shaded span running through both panels, from the
 * lap the voice peaked to the lap the pace went. It is drawn from the backend's
 * lead-lag peak, never from eyeballing the curves.
 */

interface Props {
  timeline: Timeline
  selectedClipId: string | null
  onSelectClip: (clipId: string) => void
  verdict: Verdict | null
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
  const r = selected ? 7.5 : 6

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
      {/* Invisible 24px hit target — the visible mark is far too small to be a
          reliable click target, especially on a projector at 3m. */}
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      {selected && (
        <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.6} />
      )}
      {shape}
    </g>
  )
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p: TimelinePoint = payload[0].payload
  return (
    <div className="panel px-3 py-2 text-xs shadow-xl">
      <div className="tower text-ink-primary" style={{ fontSize: 14 }}>
        LAP {p.lap}
      </div>
      {p.delta_s != null && (
        <div className="tabular mt-1 text-ink-secondary">
          Pace {p.delta_s > 0 ? '+' : ''}
          {p.delta_s.toFixed(2)}s vs clean-lap median
        </div>
      )}
      {p.stress_index != null && (
        <div className="tabular text-ink-secondary">Stress {Math.round(p.stress_index)}/100</div>
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

export function RaceTimeline({ timeline, selectedClipId, onSelectClip, verdict }: Props) {
  const data = timeline.points
  const selected = timeline.clips.find((c) => c.clip_id === selectedClipId)
  const hasStress = data.some((p) => p.stress_index != null)

  const { domain: paceDomain, clipped } = robustDomain(
    data.map((p) => p.delta_s).filter((v): v is number => v != null),
  )

  const peakLap = verdict?.peakStress?.lap ?? null
  const lossLap = verdict?.paceLossLap ?? null
  const bandLaps = verdict?.leadLaps ?? null
  // Only draw the band when both ends exist in the plotted range; a reference
  // area anchored to a lap the axis doesn't contain renders in the wrong place.
  const laps = new Set(data.map((p) => p.lap))
  const showBand =
    peakLap != null && lossLap != null && laps.has(peakLap) && laps.has(lossLap)

  /** Shared furniture, so both panels annotate the same laps identically. */
  const annotations = (showLabel: boolean) => (
    <>
      {showBand && (
        <ReferenceArea
          x1={peakLap!}
          x2={lossLap!}
          fill="var(--status-critical)"
          fillOpacity={0.13}
          stroke="var(--status-critical)"
          strokeOpacity={0.35}
          strokeDasharray="3 3"
          label={
            showLabel
              ? {
                  value: `${bandLaps} ${bandLaps === 1 ? 'LAP' : 'LAPS'} OF WARNING`,
                  position: 'insideTop',
                  fill: 'var(--status-critical)',
                  fontSize: 10,
                  fontWeight: 700,
                  offset: 8,
                }
              : undefined
          }
        />
      )}
      {selected?.lap != null && (
        <ReferenceLine x={selected.lap} stroke="var(--accent-cyan)" strokeOpacity={0.45} strokeWidth={1} />
      )}
    </>
  )

  return (
    <section className="panel overflow-hidden" aria-label="Race timeline">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-5">
        <div>
          <h2 className="display text-[17px] uppercase text-ink-primary">The evidence</h2>
          <p className="mt-1 text-xs text-ink-secondary">
            Voice stress and race pace on one lap axis. Click any marker to hear the call.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--series-1)' }} />
            Pace delta
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-4 rounded-sm"
              style={{ background: 'var(--series-2)', opacity: 0.55 }}
            />
            Stress index
          </span>
        </div>
      </header>

      {/* ── PANEL 1 — race pace ─────────────────────────────────────────── */}
      <div className="px-4 sm:px-5">
        <PanelLabel
          index={1}
          title="Race pace"
          hint="seconds vs this driver's clean-lap median · higher is slower"
        />
      </div>
      <div className="h-[168px] pr-2 sm:h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="race" margin={{ top: 14, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="lap"
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={26}
              height={30}
            />
            <YAxis
              width={58}
              domain={paceDomain}
              allowDataOverflow
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}s`}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
            {annotations(true)}
            {showBand && (
              <ReferenceLine
                x={lossLap!}
                stroke="var(--series-1)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={{
                  value: `PACE GONE · L${lossLap}`,
                  position: 'insideBottomRight',
                  fill: 'var(--series-1)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
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

      {/* ── PANEL 2 — voice stress ──────────────────────────────────────── */}
      <div className="px-4 pt-3 sm:px-5">
        <PanelLabel
          index={2}
          title="Voice stress"
          hint="0–100 from the scoring head · marker shape is the mood"
        />
      </div>
      <div className="relative h-[186px] pr-2 sm:h-[224px]">
        {!hasStress && (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center">
            <p className="max-w-sm text-xs leading-snug text-ink-muted">
              No radio scored for this driver yet. Pick a clip from the library and the stress
              track fills in.
            </p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} syncId="race" margin={{ top: 14, right: 12, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="stressFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="lap"
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={26}
              height={30}
              label={{ value: 'Lap', position: 'insideBottom', offset: -1, fill: MUTED, fontSize: 10 }}
            />
            <YAxis
              width={58}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: AXIS }}
              tickLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
            {annotations(false)}
            {showBand && (
              <ReferenceLine
                x={peakLap!}
                stroke="var(--status-critical)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={{
                  value: `VOICE PEAK · L${peakLap}`,
                  position: 'insideTopLeft',
                  fill: 'var(--status-critical)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
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

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-4 py-3 text-[11px] text-ink-muted sm:px-5">
        <span className="flex flex-wrap items-center gap-3">
          <span className="eyebrow">Radio calls</span>
          <MoodKey mood="Calm" />
          <MoodKey mood="Stressed" />
          <MoodKey mood="Tired" />
        </span>
        {clipped > 0 && (
          <span>
            Axis fitted to the racing range; {clipped} lap{clipped === 1 ? '' : 's'} beyond it (pit
            stop or incident) extend past the top.
          </span>
        )}
      </footer>
    </section>
  )
}

function PanelLabel({ index, title, hint }: { index: number; title: string; hint: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className="tower text-ink-muted" style={{ fontSize: 13 }}>
        {index}
      </span>
      <span className="font-semibold text-ink-primary">{title}</span>
      <span className="text-ink-muted">{hint}</span>
    </p>
  )
}

function MoodKey({ mood }: { mood: Mood }) {
  const fill = MOOD_COLOR[mood]
  return (
    <span className="flex items-center gap-1.5 text-ink-secondary">
      <svg width="11" height="11" aria-hidden>
        {mood === 'Calm' ? (
          <circle cx="5.5" cy="5.5" r="4.5" fill={fill} />
        ) : mood === 'Stressed' ? (
          <polygon points="5.5,0.5 11,10.5 0,10.5" fill={fill} />
        ) : (
          <rect x="0.5" y="0.5" width="10" height="10" fill={fill} />
        )}
      </svg>
      {mood}
    </span>
  )
}
