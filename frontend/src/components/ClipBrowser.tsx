import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { getLibrary } from '../api'
import { lapLabel, clamp } from '../lib/format'
import { MOOD_COLOR } from '../lib/mood'
import type { ClipSummary } from '../types'

/**
 * The brief's first deliverable: "play *or* upload a radio clip."
 *
 * Upload was already built; this is the play half. Without it the curated clips
 * on disk were unreachable from the UI — the timeline only lists clips that
 * already have a cached analysis, so an empty results/ meant an empty timeline
 * and no way to play anything. This lists clips by lap regardless of whether
 * they have been scored yet.
 *
 * Selecting an unscored clip runs the pipeline live, which takes around thirteen
 * seconds, so the footnote says so before it is clicked and the row shows a
 * pulse while it runs. A row that silently goes quiet for that long reads as a
 * broken click.
 */

interface Props {
  sessionId: string
  driver: string
  selectedClipId: string | null
  onSelect: (clipId: string) => void
  /** Bump to refetch — the mood badges and the scored counter go stale the
   *  moment a clip finishes, and a list still saying "unscored" next to a
   *  result on screen reads as a bug. */
  refreshKey: number
  /** Clip currently being scored over the WebSocket, if any. */
  streamingClipId: string | null
}

/* One row is 9px + 9px padding over an 11.5px line, and the gap is 3px. The
   skeleton, the error and the empty state are all sized off this so the card
   keeps its height in every state instead of collapsing beside a full sibling. */
const ROW_H = 30
const SKELETON_ROWS = 7
const LIST_MIN = ROW_H * SKELETON_ROWS + 3 * (SKELETON_ROWS - 1)

const GRID = '38px 76px 1fr 34px'

export function ClipBrowser({
  sessionId,
  driver,
  selectedClipId,
  onSelect,
  refreshKey,
  streamingClipId,
}: Props) {
  const [clips, setClips] = useState<ClipSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /* Bumping this re-runs the fetch below. Without it a single failed request —
     which is all it takes, since `get()` has no retry — leaves this card dead
     for the rest of the session, because nothing else re-runs the effect until
     the driver changes. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!sessionId) return
    let live = true
    // Only a driver or session change blanks the list. A refetch triggered by a
    // finished analysis must not throw the reader back to a skeleton and lose
    // their scroll position.
    setLoading(true)
    setError(null)
    getLibrary(sessionId, driver)
      .then((list) => live && setClips(list))
      .catch((err: unknown) => {
        if (!live) return
        setClips([])
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, driver, attempt])

  useEffect(() => {
    if (!refreshKey || !sessionId) return
    let live = true
    getLibrary(sessionId, driver)
      .then((list) => live && setClips(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Selection also arrives from outside — clicking a marker on the timeline. If
  // the list doesn't follow, the selected row is offscreen and the click reads
  // as having done nothing.
  const selectedRow = useRef<HTMLButtonElement | null>(null)
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedClipId || scrolledTo.current === selectedClipId) return
    const el = selectedRow.current
    // Not rendered yet (selection landed before the fetch did) — leaving
    // `scrolledTo` unset means the next clips change retries.
    if (!el) return
    scrolledTo.current = selectedClipId
    el.scrollIntoView({ block: 'nearest' })
  }, [selectedClipId, clips])

  const scored = clips.filter((c) => c.analysed).length
  const counter = loading || error ? '—/— scored' : `${scored}/${clips.length} scored`

  return (
    /* The sidebar's shock absorber.

       How tall this column comes out depends entirely on how much radio the
       driver has, and the main grid stretches the shorter column to the taller —
       so somewhere in here has to spend the difference, which ran up to 266px of
       bare page. `flex-1` puts it in this card, the one whose content is
       naturally elastic: a list of rows reads the same at any height, which is
       not true of the inspector above it. */
    <section
      className="panel flex flex-1 flex-col"
      style={{ padding: 18 }}
      aria-label="Radio library"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="eyebrow-lg">RADIO LIBRARY</h2>
        <span className="mono text-[10.5px] font-medium leading-none text-t2">{counter}</span>
      </div>

      {/* The rows live in their own positioned box, and everything in it is
          absolute, so its content contributes nothing to the card's natural
          height — only `minHeight` does.

          That distinction is the whole trick. `flex-1` alone let a 28-clip list
          expand the card to 1028px, which made the sidebar the taller column and
          moved the 500px of dead space into the evidence column instead of
          removing it; a `max-height` would have bounded that but would equally
          have bounded the growth, which is the thing worth keeping. Absolute
          children give both: the card asks for seven rows' worth, grows to fill
          whatever the grid hands it, and the list scrolls inside the result. */}
      <div className="relative mt-3 flex-1" style={{ minHeight: LIST_MIN }}>
        {loading ? (
          <Skeleton />
        ) : error ? (
          <Filler>
            <p className="text-[12.5px] font-normal leading-[1.5] text-t2">
              Could not load {driver}’s clip library. The request to{' '}
              <span className="mono text-t1">/api/clips/library</span> failed:
            </p>
            <p className="mono mt-2 text-[11px] leading-[1.5] text-t3">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 h-[32px] self-start rounded-[5px] border border-line2 bg-s2 px-3.5 font-cond text-[11px] font-semibold uppercase tracking-[0.2em] text-t1 transition-[border-color,color] duration-[160ms] hover:border-pap hover:text-pap"
            >
              Try again
            </button>
          </Filler>
        ) : !clips.length ? (
          <Filler>
            <p className="text-[12.5px] font-normal leading-[1.5] text-t2">
              No radio was indexed for {driver} at this race. Pick another driver, or upload a clip
              of your own — an upload runs the same pipeline and lands in the same timeline.
            </p>
          </Filler>
        ) : (
          <div className="absolute inset-0 flex flex-col gap-[3px] overflow-y-auto pr-1">
            {clips.map((c) => {
              const selected = c.clip_id === selectedClipId
              return (
                <Row
                  key={c.clip_id}
                  clip={c}
                  selected={selected}
                  streaming={c.clip_id === streamingClipId}
                  onSelect={onSelect}
                  rowRef={selected ? selectedRow : null}
                />
              )
            })}
          </div>
        )}
      </div>

      <p
        className="text-[11px] font-normal leading-[1.5] text-t3"
        style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}
      >
        Scored clips open instantly. An unscored one runs the full pipeline live — about 13
        seconds, every stage shown as it happens.
      </p>
    </section>
  )
}

/* Both of these fill the positioned box above rather than sizing it — same
   reason as the list: whatever is on screen here must not be what decides how
   tall the card is, or the card decides how tall the whole page is. */

/** Says why there are no rows, vertically centred in the space they'd have had. */
function Filler({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col justify-center">{children}</div>
}

function Skeleton() {
  return (
    <div className="absolute inset-0 flex flex-col gap-[3px] overflow-hidden" aria-hidden>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div
          key={i}
          className="anim-pulse shrink-0 rounded-[5px] bg-s2"
          style={{ height: ROW_H, animationDelay: `${i * 0.09}s` }}
        />
      ))}
    </div>
  )
}

function Row({
  clip,
  selected,
  streaming,
  onSelect,
  rowRef,
}: {
  clip: ClipSummary
  selected: boolean
  streaming: boolean
  onSelect: (id: string) => void
  rowRef: RefObject<HTMLButtonElement | null> | null
}) {
  const colour = clip.mood ? MOOD_COLOR[clip.mood] : 'var(--t3)'

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={() => onSelect(clip.clip_id)}
      aria-current={selected || undefined}
      aria-busy={streaming || undefined}
      className={`shrink-0 hover:bg-s3 ${selected ? 'bg-s2' : 'bg-transparent'}`}
      style={{
        display: 'grid',
        gridTemplateColumns: GRID,
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        borderRadius: 5,
        textAlign: 'left',
        transition: 'background .16s',
        borderLeft: `2px solid ${selected ? 'var(--pap)' : 'transparent'}`,
      }}
    >
      <span className="mono text-[11.5px] font-medium leading-none text-t2">
        {lapLabel(clip.lap)}
      </span>

      <span
        className="truncate font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[0.16em]"
        style={{ color: colour }}
      >
        {clip.mood ?? 'Unscored'}
      </span>

      {/* Both spans are display:block on purpose — an inline span in a grid cell
          collapses to zero height and the track disappears. */}
      <span
        style={{
          display: 'block',
          height: 3,
          background: 'var(--s3)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {clip.stress_index != null && (
          <span
            style={{
              display: 'block',
              height: '100%',
              background: colour,
              width: `${clamp(clip.stress_index, 0, 100)}%`,
            }}
          />
        )}
      </span>

      {streaming ? (
        <span className="flex items-center justify-end">
          <span
            className="anim-pulse block rounded-full"
            style={{ width: 6, height: 6, background: 'var(--mag)' }}
            aria-hidden
          />
          <span className="sr-only">Scoring now</span>
        </span>
      ) : (
        <span className="mono text-right text-[11.5px] font-medium leading-none text-t1">
          {clip.stress_index != null ? Math.round(clip.stress_index) : '—'}
        </span>
      )}
    </button>
  )
}
