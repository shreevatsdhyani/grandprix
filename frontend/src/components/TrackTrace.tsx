import { useMemo, useState } from 'react'
import type { Circuit } from '../lib/circuits'
import { parsePath, pointAtFraction } from '../lib/trackGeometry'
import type { ClipAnalysis, ClipContext, Mood, ScoringMode } from '../types'
import { MOOD_COLOR } from '../types'

/**
 * Literal token values rather than `var(--…)`.
 *
 * The design tokens are declared twice in this project — as Tailwind colours in
 * tailwind.config.js and as CSS custom properties in index.css — under different
 * names (`hairline-bright` vs `--edge-bright`). Tailwind class names work in
 * `className`; raw `var()` in an SVG presentation attribute needs the index.css
 * name, and getting it wrong fails silently: the stroke renders as `none` and the
 * shape simply is not there. Naming the values here removes that trap.
 */
const TRACK_SURFACE = '#38404f' // hairline-bright
const TRACK_CENTRELINE = '#7A8290' // ink-muted, brightened for hairlines
const LABEL_ON_MARK = '#07080b' // plane, for text sitting on a bright glyph

/**
 * Where on the lap the driver was when they spoke.
 *
 * This is the one place the panel spends its boldness, and it earns it: until we
 * resolved each radio call to an exact instant, this view was not possible to
 * draw at all. A stress chart tells you a driver struggled on lap 37. This tells
 * you it happened on the approach to Turn 4 at 120kph, every time, all race —
 * which is the question a race engineer actually asks.
 *
 * The outline is the real GPS trace of the fastest lap, and each call sits at its
 * true arc-length position, so the pattern of marks is a genuine spatial reading
 * of the session rather than an illustration. Marks are mood-coloured AND
 * mood-shaped, matching the chart, because red/green alone fails colour-vision
 * separation.
 */

interface Props {
  circuit: Circuit
  clips: ClipAnalysis[]
  contexts: Record<string, ClipContext>
  mode: ScoringMode
  selectedClipId: string | null
  onSelectClip?: (clipId: string) => void
}

interface Mark {
  clipId: string
  lap: number
  fraction: number
  x: number
  y: number
  mood: Mood
  stress: number
  corner: number | null
  speed: number | null
  transcript: string
}

/** Mood glyphs, matching RaceTimeline's MoodDot so the two read as one system. */
function MarkGlyph({ mood, x, y, r }: { mood: Mood; x: number; y: number; r: number }) {
  const fill = MOOD_COLOR[mood]
  if (mood === 'Calm') return <circle cx={x} cy={y} r={r} fill={fill} />
  if (mood === 'Stressed') {
    return (
      <polygon
        points={`${x},${y - r * 1.15} ${x + r * 1.1},${y + r * 0.8} ${x - r * 1.1},${y + r * 0.8}`}
        fill={fill}
      />
    )
  }
  return <rect x={x - r * 0.92} y={y - r * 0.92} width={r * 1.84} height={r * 1.84} fill={fill} />
}

export function TrackTrace({
  circuit,
  clips,
  contexts,
  mode,
  selectedClipId,
  onSelectClip,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const points = useMemo(() => parsePath(circuit.path), [circuit.path])

  const marks = useMemo<Mark[]>(() => {
    const out: Mark[] = []
    for (const clip of clips) {
      const ctx = contexts[clip.clip_id]
      // Only racing laps with a resolved position can be placed. Grid and
      // post-flag radio has no position, and guessing one would be a fabrication.
      if (!ctx || ctx.phase !== 'racing' || ctx.lap == null) continue
      const pct = ctx.position?.pct_of_lap
      if (pct == null) continue
      const at = pointAtFraction(points, pct / 100)
      if (!at) continue
      const result = mode === 'fusion' ? clip.fusion : clip.naive
      out.push({
        clipId: clip.clip_id,
        lap: ctx.lap,
        fraction: pct / 100,
        x: at.x,
        y: at.y,
        mood: result.mood,
        stress: result.stress_index,
        corner: ctx.position?.nearest_corner ?? null,
        speed: ctx.position?.speed_kph ?? null,
        transcript: clip.transcript.text,
      })
    }
    return out.sort((a, b) => a.lap - b.lap)
  }, [clips, contexts, points, mode])

  const active = marks.find((m) => m.clipId === (hovered ?? selectedClipId)) ?? null
  const unplaced = clips.length - marks.length

  /**
   * Why nothing could be placed, when nothing could.
   *
   * The three reasons are not the same and the reader needs to know which one
   * they are looking at. A driver whose only two calls were on the grid and
   * after the flag has a perfectly healthy pipeline and an empty trace; telling
   * them to re-run build_context.py sends them chasing a bug that isn't there.
   */
  const emptyReason = useMemo(() => {
    if (clips.length === 0) return 'no_clips' as const
    const resolved = clips.filter((c) => contexts[c.clip_id])
    if (resolved.length === 0) return 'unresolved' as const
    if (!resolved.some((c) => contexts[c.clip_id].phase === 'racing')) return 'off_lap' as const
    return 'no_position' as const
  }, [clips, contexts])

  return (
    <section className="panel overflow-hidden" aria-label="Radio calls by track position">
      <header className="px-4 pb-3 pt-4 sm:px-5">
        <h2 className="display text-[17px] uppercase text-ink-primary">Where it happened</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
          Every radio call placed at the point on the lap it was transmitted, on{' '}
          {circuit.location}&rsquo;s real GPS trace.
        </p>
      </header>

      {marks.length === 0 ? (
        <p className="px-4 pb-5 text-sm leading-relaxed text-ink-muted sm:px-5">
          {emptyReason === 'no_clips' && 'No radio calls in this session for this driver.'}
          {emptyReason === 'off_lap' && (
            <>
              Nothing to place: all {clips.length}{' '}
              {clips.length === 1 ? 'call was' : 'calls were'} transmitted off the racing lap — on
              the grid or after the chequered flag — so {clips.length === 1 ? 'it has' : 'they have'}{' '}
              no position on the trace.
            </>
          )}
          {emptyReason === 'no_position' && (
            <>
              Calls were made on the lap, but none fell inside a stretch with position telemetry, so
              none can be placed on the trace.
            </>
          )}
          {emptyReason === 'unresolved' && (
            <>
              These calls have not been resolved to a time on the lap yet. Run{' '}
              <span className="mono text-[11px]">scripts/build_context.py</span> to resolve radio
              timestamps to track positions.
            </>
          )}
        </p>
      ) : (
        <>
          <div className="relative px-4 sm:px-5">
            <svg
              viewBox={`-40 -40 1080 ${circuit.height + 80}`}
              width="100%"
              className="mx-auto block w-full"
              style={{ maxHeight: 460 }}
              role="img"
              aria-label={`${circuit.location} outline with ${marks.length} radio calls marked by track position`}
            >
              {/* The track, quiet, so the marks carry the reading. */}
              <path
                d={circuit.path}
                fill="none"
                stroke={TRACK_SURFACE}
                strokeWidth={18}
                strokeLinejoin="round"
                strokeOpacity={0.9}
              />
              <path
                d={circuit.path}
                fill="none"
                stroke={TRACK_CENTRELINE}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeOpacity={0.55}
                strokeDasharray="2 14"
              />

              {/* Start line, so the reader can orient the loop. */}
              {points[0] && (
                <g>
                  <circle cx={points[0].x} cy={points[0].y} r={13} fill="none" stroke={TRACK_CENTRELINE} strokeWidth={1.5} />
                  <text
                    x={points[0].x}
                    y={points[0].y - 34}
                    textAnchor="middle"
                    className="mono"
                    fill={TRACK_CENTRELINE}
                    fontSize={20}
                  >
                    S/F
                  </text>
                </g>
              )}

              {marks.map((m) => {
                const isActive = m.clipId === (hovered ?? selectedClipId)
                // Radius carries stress, so a cluster of small calm marks and one
                // large stressed mark read differently at a glance.
                const r = 15 + (m.stress / 100) * 15
                return (
                  <g
                    key={m.clipId}
                    onMouseEnter={() => setHovered(m.clipId)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => onSelectClip?.(m.clipId)}
                    className="cursor-pointer"
                  >
                    {isActive && (
                      <circle cx={m.x} cy={m.y} r={r + 12} fill={MOOD_COLOR[m.mood]} fillOpacity={0.18} />
                    )}
                    <MarkGlyph mood={m.mood} x={m.x} y={m.y} r={r} />
                    <text
                      x={m.x}
                      y={m.y + (m.mood === 'Stressed' ? r * 0.62 : r * 0.34)}
                      textAnchor="middle"
                      className="mono"
                      fill={LABEL_ON_MARK}
                      fontSize={Math.max(10, r * 0.9)}
                      fontWeight={700}
                      pointerEvents="none"
                    >
                      {m.lap}
                    </text>
                    {/* A generous invisible hit target; the glyphs are small. */}
                    <circle cx={m.x} cy={m.y} r={Math.max(r + 8, 20)} fill="transparent" />
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Readout rather than a floating tooltip: it holds still, so a reader
              can compare two calls by hovering each in turn. */}
          <div className="mt-1 min-h-[74px] border-t border-hairline px-4 py-3 sm:px-5">
            {active ? (
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="tower text-ink-muted" style={{ fontSize: 13 }}>
                    LAP {active.lap}
                  </span>
                  <span
                    className="mono text-[11px] font-semibold uppercase"
                    style={{ color: MOOD_COLOR[active.mood] }}
                  >
                    {active.mood}
                  </span>
                  <span className="mono tabular text-[11px] text-ink-muted">
                    stress {active.stress.toFixed(0)}
                  </span>
                  {active.corner != null && (
                    <span className="mono text-[11px] text-ink">Turn {active.corner}</span>
                  )}
                  {active.speed != null && (
                    <span className="mono tabular text-[11px] text-ink-muted">
                      {active.speed.toFixed(0)} kph
                    </span>
                  )}
                  <span className="mono tabular text-[11px] text-ink-muted">
                    {(active.fraction * 100).toFixed(0)}% of lap
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-secondary">
                  &ldquo;{active.transcript.trim()}&rdquo;
                </p>
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted">
                Hover a mark to read the call. Mark size is stress; shape and colour are mood.
              </p>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-4 py-2.5 text-[10px] text-ink-muted sm:px-5">
            <span className="mono">
              {marks.length} of {clips.length} calls placed
            </span>
            {unplaced > 0 && (
              <span>
                {unplaced} not placed — transmitted on the grid, after the flag, or during a
                telemetry gap.
              </span>
            )}
          </footer>
        </>
      )}
    </section>
  )
}
