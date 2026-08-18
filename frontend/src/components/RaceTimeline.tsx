import { useMemo } from 'react'
import { MOOD_COLOR, moodMarker } from '../lib/mood'
import type { Mood, Timeline, TimelinePoint } from '../types'
import type { Verdict } from '../lib/verdict'

/**
 * Voice stress and race pace on one lap axis.
 *
 * Two charts rather than one with twin y-axes. A dual axis lets a reader draw
 * whatever conclusion the scaling flatters — and the conclusion here is about
 * *when* two curves turn, not how their magnitudes compare, so a shared x and
 * separate y is both more honest and easier to read.
 *
 * Hand-built SVG rather than a chart library. The annotation lines, the
 * mood-shaped markers, the line-draw reveal and the break-on-null pace path all
 * have to be exact, and expressing them through a library's escape hatches was
 * longer than the geometry itself.
 */

/* Shared frame. The 912-unit width is the design's; `width:100%` on a viewBox
   makes it responsive without recomputing anything. */
const W = 912
const PAD_L = 44
const PAD_R = 10
const SPAN = W - PAD_L - PAD_R

/* Pace panel: 0 at y=61, one second of delta spanning 51 units either way. */
const PACE_H = 150
const PACE_TOP = 10
const PACE_BOTTOM = 126

/* Stress panel: 0–100 maps 176 → 18. */
const STRESS_TOP = 18
const STRESS_BOTTOM = 176

interface Props {
  timeline: Timeline
  verdict: Verdict
  /**
   * The scheduled race distance, for comparison only — the axis is always this
   * driver's own laps. A retirement makes the two differ a lot (Tsunoda ran 7 of
   * Monza's 53) and an axis that stops at 7 next to a banner reading 53 LAPS
   * reads as a broken chart unless the caption says whose laps these are.
   */
  raceLaps: number | null
  selectedClipId: string | null
  onSelectClip: (clipId: string) => void
}

type Scored = TimelinePoint & { stress_index: number; mood: Mood }

export function RaceTimeline({
  timeline,
  verdict,
  raceLaps,
  selectedClipId,
  onSelectClip,
}: Props) {
  const geo = useMemo(() => layout(timeline.points), [timeline.points])
  const { totalLaps, x, paceY, domain, clipped, paceSegments, scored, ticks } = geo

  const peakLap = verdict.peakStress?.lap ?? null
  const lossLap =
    verdict.paceLossLap != null ? Math.min(verdict.paceLossLap, totalLaps) : null
  const showWindow = peakLap != null && lossLap != null && lossLap > peakLap

  return (
    <section className="panel px-5 pb-4 pt-5" aria-label="The evidence">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-cond text-[17px] font-bold uppercase leading-none tracking-[0.14em] text-t1">
            The Evidence
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.4] text-t3">
            Voice stress and race pace on one lap axis. Click any marker to hear the call.
          </p>
        </div>

        <div className="flex gap-4 pt-0.5">
          <LegendItem label="Pace delta">
            <span className="h-[2px] w-4 flex-none bg-cyan" />
          </LegendItem>
          <LegendItem label="Stress index">
            <span className="h-[11px] w-[11px] flex-none rounded-[1px] bg-mag" />
          </LegendItem>
        </div>
      </div>

      {/* ── 1 · Race pace ─────────────────────────────────────────────────── */}
      <ChartCaption
        index="1"
        name="Race pace"
        /* The short-race clause only appears when it is doing work. Two laps of
           slack is a formation lap or a timing gap on the last tour, not a story;
           more than that is a retirement, and then the axis needs accounting for. */
        note={`seconds vs this driver's clean-lap median · higher is slower · the line breaks on laps with no clean time${
          raceLaps != null && raceLaps - totalLaps > 2
            ? ` · laps 1–${totalLaps} of ${raceLaps} — this driver's race ended early`
            : ''
        }`}
      />

      <svg
        viewBox={`0 0 ${W} ${PACE_H}`}
        className="mt-2 block h-auto w-full overflow-visible"
        role="img"
        aria-label={`Race pace by lap for ${timeline.driver}`}
      >
        {domain.lines.map((v) => (
          <line
            key={v}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={paceY(v)}
            y2={paceY(v)}
            stroke="var(--grid)"
            strokeWidth={1}
            strokeDasharray="3 5"
          />
        ))}

        {/* Zero is the driver's own median, so it gets a solid rule — every
            reading on this panel is relative to it. */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={paceY(0)}
          y2={paceY(0)}
          stroke="var(--line2)"
          strokeWidth={1}
        />

        {domain.lines.map((v) => (
          <text
            key={v}
            x={PAD_L - 6}
            y={paceY(v) + 3}
            textAnchor="end"
            fill="var(--t3)"
            fontFamily="Roboto Mono, monospace"
            fontSize={9.5}
          >
            {formatDelta(v, domain.dp)}
          </text>
        ))}

        {showWindow && (
          <>
            {/* The window between the voice peak and the pace drop — the finding,
                drawn rather than described. */}
            <rect
              x={x(peakLap)}
              y={PACE_TOP - 6}
              width={Math.max(2, x(lossLap) - x(peakLap))}
              height={PACE_BOTTOM - PACE_TOP + 6}
              fill="var(--mag)"
              opacity={0.16}
            />
            <line
              x1={x(lossLap)}
              x2={x(lossLap)}
              y1={PACE_TOP - 6}
              y2={PACE_BOTTOM}
              stroke="var(--cyan)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={(x(peakLap) + x(lossLap)) / 2}
              y={PACE_TOP - 12}
              textAnchor="middle"
              fill="var(--mag)"
              fontFamily="Barlow Condensed, sans-serif"
              fontSize={10.5}
              fontWeight={700}
              letterSpacing={1.4}
            >
              {verdict.leadLaps} {verdict.leadLaps === 1 ? 'LAP' : 'LAPS'} OF WARNING
            </text>
            <text
              x={x(lossLap) - 4}
              y={PACE_BOTTOM + 13}
              textAnchor="end"
              fill="var(--cyan)"
              fontFamily="Barlow Condensed, sans-serif"
              fontSize={10}
              fontWeight={700}
              letterSpacing={1.2}
            >
              PACE GONE · L{lossLap}
            </text>
          </>
        )}

        {paceSegments.map((seg, i) =>
          seg.length === 1 ? (
            /* A clean lap with clean laps either side of it is a real reading
               and has to be visible; a one-point path draws nothing. */
            <circle
              key={i}
              cx={x(seg[0].lap)}
              cy={paceY(seg[0].delta)}
              r={2}
              fill="var(--cyan)"
              className="anim-fin"
            />
          ) : (
            <path
              key={i}
              d={`M${seg.map((p) => `${x(p.lap)} ${paceY(p.delta)}`).join(' L')}`}
              fill="none"
              stroke="var(--cyan)"
              strokeWidth={1.9}
              strokeLinejoin="round"
              strokeLinecap="round"
              /* pathLength normalises the geometry to 1 unit, so one dasharray
                 value reveals every segment regardless of its real length —
                 otherwise each path needs its own measured length from the DOM. */
              pathLength={1}
              style={{
                ['--gp-len' as string]: 1,
                strokeDasharray: 1,
                strokeDashoffset: 1,
                animation: 'gp-draw 1.5s cubic-bezier(.25,.8,.25,1) .15s forwards',
                filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--cyan) 35%, transparent))',
              }}
            />
          ),
        )}

        {ticks.map((l) => (
          <text
            key={l}
            x={x(l)}
            y={PACE_H - 3}
            textAnchor="middle"
            fill="var(--t3)"
            fontFamily="Roboto Mono, monospace"
            fontSize={9}
          >
            {l}
          </text>
        ))}
      </svg>

      {/* ── 2 · Voice stress ──────────────────────────────────────────────── */}
      <ChartCaption
        index="2"
        name="Voice stress"
        note="0–100 from the scoring head · the line joins scored calls · marker shape is the mood"
      />

      <svg
        viewBox={`0 0 ${W} 200`}
        className="mt-2 block h-auto w-full overflow-visible"
        role="img"
        aria-label={`Voice stress index by lap for ${timeline.driver}`}
      >
        <defs>
          <linearGradient id="gp-stress-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--mag)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--mag)" stopOpacity={0} />
          </linearGradient>
        </defs>

        {[100, 75, 50, 25, 0].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={stressY(v)}
              y2={stressY(v)}
              stroke="var(--grid)"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
            <text
              x={PAD_L - 6}
              y={stressY(v) + 3}
              textAnchor="end"
              fill="var(--t3)"
              fontFamily="Roboto Mono, monospace"
              fontSize={9.5}
            >
              {v}
            </text>
          </g>
        ))}

        {peakLap != null && (
          <>
            <line
              x1={x(peakLap)}
              x2={x(peakLap)}
              y1={STRESS_TOP - 8}
              y2={STRESS_BOTTOM}
              stroke="var(--mag)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {/* Flipped to the left of its rule once the peak is late in the race.
                These SVGs are `overflow-visible` so the annotations can sit above
                the plot, which also means a label anchored right of lap 70 paints
                past the card and drags a horizontal scrollbar onto the page. */}
            <text
              x={x(peakLap) + (x(peakLap) > PAD_L + SPAN * 0.75 ? -8 : 8)}
              y={STRESS_TOP - 2}
              textAnchor={x(peakLap) > PAD_L + SPAN * 0.75 ? 'end' : 'start'}
              fill="var(--yel)"
              fontFamily="Barlow Condensed, sans-serif"
              fontSize={10}
              fontWeight={700}
              letterSpacing={1.2}
            >
              VOICE PEAK · L{peakLap}
            </text>
          </>
        )}

        {/* Nothing scored. The gridlines and the 0–100 axis are still the right
            furniture to show — they say what will be plotted — but on their own
            they are 160px of ruled emptiness, which is the one thing a reader
            cannot tell apart from a chart that failed to draw. So the plot area
            says it, inside the frame, where the missing line would have been. */}
        {scored.length === 0 && (
          <text
            x={PAD_L + (W - PAD_L - PAD_R) / 2}
            y={(STRESS_TOP + STRESS_BOTTOM) / 2 + 4}
            textAnchor="middle"
            fill="var(--t3)"
            fontSize="12"
            style={{ animation: 'gp-fin .5s .2s both' }}
          >
            No radio scored on these laps — select a call from the library to plot one
          </text>
        )}

        {scored.length > 1 && (
          <>
            <path
              d={`M${scored.map((p) => `${x(p.lap)} ${stressY(p.stress_index)}`).join(' L')} L${x(
                scored[scored.length - 1].lap,
              )} ${STRESS_BOTTOM} L${x(scored[0].lap)} ${STRESS_BOTTOM} Z`}
              fill="url(#gp-stress-fill)"
              style={{ animation: 'gp-fin .9s .55s both' }}
            />
            <path
              d={`M${scored.map((p) => `${x(p.lap)} ${stressY(p.stress_index)}`).join(' L')}`}
              fill="none"
              stroke="var(--mag)"
              strokeWidth={2.1}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              style={{
                ['--gp-len' as string]: 1,
                strokeDasharray: 1,
                strokeDashoffset: 1,
                animation: 'gp-draw 1.3s cubic-bezier(.25,.8,.25,1) .35s forwards',
                filter: 'drop-shadow(0 0 7px color-mix(in srgb, var(--mag) 40%, transparent))',
              }}
            />
          </>
        )}

        <g style={{ animation: 'gp-fin .3s 1.1s both' }}>
          {scored.map((p) => {
            const cx = x(p.lap)
            const cy = stressY(p.stress_index)
            const marker = moodMarker(p.mood, cx, cy)
            const colour = MOOD_COLOR[p.mood]
            const selected = p.clip_id != null && p.clip_id === selectedClipId

            return (
              <g
                key={`${p.lap}-${p.clip_id ?? 'x'}`}
                role={p.clip_id ? 'button' : undefined}
                tabIndex={p.clip_id ? 0 : undefined}
                className={p.clip_id ? 'cursor-pointer' : undefined}
                onClick={p.clip_id ? () => onSelectClip(p.clip_id as string) : undefined}
                onKeyDown={
                  p.clip_id
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectClip(p.clip_id as string)
                        }
                      }
                    : undefined
                }
              >
                <title>{`Lap ${p.lap} · ${p.mood} · ${Math.round(p.stress_index)}/100`}</title>

                {selected && (
                  <circle cx={cx} cy={cy} r={10} fill="none" stroke={colour} strokeWidth={1.5} opacity={0.55} />
                )}

                {/* Colour alone does not carry mood — red and green separate by
                    ΔE 4.1 for a deuteranope — so the shape says it too. */}
                {marker.shape === 'circle' ? (
                  <circle cx={cx} cy={cy} r={marker.r} fill={colour} stroke="var(--s1)" strokeWidth={1.5} />
                ) : (
                  <polygon points={marker.points} fill={colour} stroke="var(--s1)" strokeWidth={1.5} />
                )}
              </g>
            )
          })}
        </g>

        {ticks.map((l) => (
          <text
            key={l}
            x={x(l)}
            y={194}
            textAnchor="middle"
            fill="var(--t3)"
            fontFamily="Roboto Mono, monospace"
            fontSize={9}
          >
            {l}
          </text>
        ))}

        <text
          x={PAD_L + SPAN / 2}
          y={212}
          textAnchor="middle"
          fill="var(--t3)"
          fontFamily="Barlow, sans-serif"
          fontSize={10.5}
        >
          Lap
        </text>
      </svg>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="mt-[22px] flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3.5">
        <span className="eyebrow">Radio calls</span>

        <MoodKey mood="Calm">
          <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: MOOD_COLOR.Calm }} />
        </MoodKey>
        <MoodKey mood="Stressed">
          <span
            className="flex-none"
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: `9px solid ${MOOD_COLOR.Stressed}`,
            }}
          />
        </MoodKey>
        <MoodKey mood="Tired">
          <span className="h-[9px] w-[9px] flex-none" style={{ background: MOOD_COLOR.Tired }} />
        </MoodKey>

        <p className="ml-auto max-w-[42ch] text-[11px] leading-[1.3] text-t3">
          {scored.length === 0
            ? 'No radio scored on this driver yet — the pace panel above is real FastF1 timing regardless.'
            : clipped > 0
              ? `Axis fitted to the racing range; ${clipped} ${
                  clipped === 1 ? 'lap sits' : 'laps sit'
                } outside it and are drawn at the edge.`
              : `${scored.length} scored ${scored.length === 1 ? 'call' : 'calls'} across ${totalLaps} laps.`}
        </p>
      </div>
    </section>
  )
}

/* ── Layout ────────────────────────────────────────────────────────────────── */

const stressY = (v: number): number =>
  STRESS_BOTTOM - (Math.min(100, Math.max(0, v)) / 100) * (STRESS_BOTTOM - STRESS_TOP)

/**
 * Everything the two charts need from the point list, computed once.
 *
 * The pace domain is fitted rather than fixed at ±0.8s. One in-lap or a safety
 * car adds a delta of several seconds, and on a fixed axis that single lap
 * flattens the rest of the race into a straight line — the exact reading the
 * panel exists to show. Anything the fit does leave outside the axis is drawn at
 * the edge and counted in the footnote, which is the honest version of clipping.
 * See `paceDomain` for why the fit is deliberately barely a fit.
 */
function layout(points: TimelinePoint[]) {
  const totalLaps = Math.max(2, ...points.map((p) => p.lap))
  const x = (lap: number): number =>
    PAD_L + ((Math.min(Math.max(lap, 1), totalLaps) - 1) / (totalLaps - 1)) * SPAN

  const deltas = points
    .filter((p): p is TimelinePoint & { delta_s: number } => p.delta_s != null)
    .map((p) => p.delta_s)

  const domain = paceDomain(deltas)
  const paceY = (v: number): number => {
    const t = (Math.min(domain.hi, Math.max(domain.lo, v)) - domain.lo) / (domain.hi - domain.lo)
    return PACE_BOTTOM - t * (PACE_BOTTOM - PACE_TOP)
  }
  const clipped = deltas.filter((v) => v < domain.lo || v > domain.hi).length

  // The pace line breaks wherever there is no clean lap time. Bridging the gap
  // would draw a straight line through laps the driver did not actually set.
  const paceSegments: { lap: number; delta: number }[][] = []
  let run: { lap: number; delta: number }[] = []
  for (const p of [...points].sort((a, b) => a.lap - b.lap)) {
    if (p.delta_s == null) {
      if (run.length) paceSegments.push(run)
      run = []
    } else {
      run.push({ lap: p.lap, delta: p.delta_s })
    }
  }
  if (run.length) paceSegments.push(run)

  const scored = points
    .filter((p): p is Scored => p.stress_index != null && p.mood != null)
    .sort((a, b) => a.lap - b.lap)

  // Roughly 20 ticks whatever the race length — every third lap over 78 laps at
  // Monaco puts the labels 33px apart and they start to collide.
  const step = Math.max(3, Math.ceil(totalLaps / 20))
  const ticks: number[] = []
  for (let l = 1; l <= totalLaps; l += step) ticks.push(l)

  // The last lap always gets a tick, but it replaces the previous one rather than
  // crowding it: 78 laps steps to 77, and "77" and "78" a pixel apart render as
  // a single unreadable "7778".
  if (ticks[ticks.length - 1] !== totalLaps) {
    if (ticks.length > 1 && totalLaps - ticks[ticks.length - 1] < step * 0.6) ticks.pop()
    ticks.push(totalLaps)
  }

  return { totalLaps, x, paceY, domain, clipped, paceSegments, scored, ticks }
}

/**
 * The pace y-range.
 *
 * Fitted, but only barely: the axis shows the real minimum and maximum and clips
 * nothing unless a lap is an order of magnitude out. An interquartile fence was
 * the obvious rule and is wrong on this data — a driver who holds position for
 * most of a race sits exactly on their own median, so the quartiles collapse
 * (Monaco/SAI: q1 = median = 0.000, IQR = 0.041) and a 1.5×IQR fence throws away
 * 41% of the laps as outliers, pinning a perfectly displayable ±1s race to both
 * rails as a sawtooth. So the rule is the other way round: keep everything, and
 * pull a rail in only when the extreme is more than 3× the 98th percentile —
 * which is an in-lap or a safety car, not a slow lap.
 */
function paceDomain(deltas: number[]): { lo: number; hi: number; lines: number[]; dp: number } {
  let lo = -0.8
  let hi = 0.8

  if (deltas.length > 0) {
    const s = [...deltas].sort((a, b) => a - b)
    lo = s[0]
    hi = s[s.length - 1]

    // Percentiles need a few laps behind them before they can call anything an
    // outlier; under eight, the extremes are the only reading there is.
    if (s.length >= 8) {
      const at = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]
      // The 0.5s floor stops a tight, low-magnitude stint from having its own
      // widest lap read as an outlier.
      const outHi = Math.max(at(0.98), 0.5) * 3
      const outLo = Math.min(at(0.02), -0.5) * 3
      if (hi > outHi) hi = at(0.98)
      if (lo < outLo) lo = at(0.02)
    }
  }

  // Zero is the reference line and must be on the chart even in a race where
  // every lap was slower than the median.
  lo = Math.min(lo, 0)
  hi = Math.max(hi, 0)

  // A dead-even stint would otherwise get an axis magnified to milliseconds,
  // where sensor noise looks like a collapse.
  const span = hi - lo
  if (span < 0.4) {
    const mid = (hi + lo) / 2
    lo = mid - 0.2
    hi = mid + 0.2
  } else {
    lo -= span * 0.08
    hi += span * 0.08
  }

  const lines = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4)
  return { lo, hi, lines, dp: hi - lo < 1.2 ? 2 : 1 }
}

const formatDelta = (v: number, dp: number): string =>
  `${v > 0.0005 ? '+' : v < -0.0005 ? '−' : ''}${Math.abs(v).toFixed(dp)}s`

/* ── Small pieces ──────────────────────────────────────────────────────────── */

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {children}
      <span className="text-[11px] leading-none text-t2">{label}</span>
    </span>
  )
}

function ChartCaption({ index, name, note }: { index: string; name: string; note: string }) {
  return (
    <div className="mt-[18px] flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="mono text-[11px] font-bold leading-none text-pap">{index}</span>
      <span className="text-[13px] font-semibold leading-none text-t1">{name}</span>
      <span className="text-[11.5px] leading-none text-t3">{note}</span>
    </div>
  )
}

function MoodKey({ mood, children }: { mood: Mood; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {children}
      <span className="text-[11.5px] leading-none text-t2">{mood}</span>
    </span>
  )
}
