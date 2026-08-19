import { useEffect, useState } from 'react'
import { getLibrary } from '../api'
import type { ClipSummary } from '../types'
import { MOOD_COLOR } from '../types'
import { SkeletonRows } from './StartLights'

/**
 * The brief's first deliverable: "play *or* upload a radio clip."
 *
 * Upload was already built; this is the play half. Without it the curated clips
 * on disk were unreachable from the UI — the timeline only lists clips that
 * already have a cached analysis, so an empty results/ meant an empty timeline
 * and no way to play anything. This lists clips by lap regardless of whether
 * they have been scored yet.
 *
 * Selecting an unscored clip runs the pipeline live, which takes around
 * thirteen seconds, so the row says so before it is clicked and shows its own
 * progress while it runs. A row that silently goes quiet for that long reads as
 * a broken click.
 */

interface Props {
  sessionId: string
  driver: string
  selectedClipId: string | null
  onSelect: (clipId: string) => void
  /** Bump to refetch — the mood badges and the scored counter go stale the
   *  moment a clip finishes, and a list still saying "not scored" next to a
   *  result on screen reads as a bug. */
  refreshKey?: number
  /** Clip currently being scored over the WebSocket, if any. */
  streamingClipId?: string | null
}

export function ClipBrowser({
  sessionId,
  driver,
  selectedClipId,
  onSelect,
  refreshKey = 0,
  streamingClipId = null,
}: Props) {
  const [clips, setClips] = useState<ClipSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sessionId) return
    let live = true
    // Only a driver or session change blanks the list. A refetch triggered by a
    // finished analysis must not throw the reader back to a skeleton and lose
    // their scroll position.
    setLoading(true)
    getLibrary(sessionId, driver)
      .then((list) => live && setClips(list))
      .catch(() => live && setClips([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, driver])

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

  const scored = clips.filter((c) => c.analysed).length

  return (
    <section className="panel flex flex-col p-4 sm:p-5" aria-label="Radio library">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">Radio library</h2>
        {!loading && clips.length > 0 && (
          <span className="mono text-[11px] text-ink-muted">
            {scored}/{clips.length} scored
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3">
          <SkeletonRows rows={7} />
          <p className="mt-2.5 text-[11px] text-ink-muted">Loading {driver}’s radio…</p>
        </div>
      ) : !clips.length ? (
        <p className="mt-2 text-sm text-ink-muted">
          No clips indexed for {driver} at this race.
        </p>
      ) : (
        <>
          <ul className="mt-2.5 max-h-[300px] space-y-1 overflow-y-auto pr-1 sm:max-h-[340px]">
            {clips.map((c) => (
              <Row
                key={c.clip_id}
                clip={c}
                active={c.clip_id === selectedClipId}
                streaming={c.clip_id === streamingClipId}
                onSelect={onSelect}
              />
            ))}
          </ul>
          <p className="mt-2.5 border-t border-hairline pt-2.5 text-[10px] leading-relaxed text-ink-muted">
            Scored clips open instantly. Picking an unscored one runs the full pipeline live —
            about 13 seconds, with every stage shown as it happens.
          </p>
        </>
      )}
    </section>
  )
}

function Row({
  clip,
  active,
  streaming,
  onSelect,
}: {
  clip: ClipSummary
  active: boolean
  streaming: boolean
  onSelect: (id: string) => void
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(clip.clip_id)}
        aria-current={active}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition"
        style={
          active
            ? {
                background: 'color-mix(in srgb, var(--team) 18%, transparent)',
                boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--team) 45%, transparent)',
              }
            : undefined
        }
      >
        <span className="tower w-8 shrink-0 text-ink-secondary" style={{ fontSize: 13 }}>
          {clip.lap != null ? `L${clip.lap}` : '—'}
        </span>

        {streaming ? (
          <span className="flex flex-1 items-center gap-2 text-[11px] text-accent-cyan">
            <span
              className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
              aria-hidden
            />
            Scoring…
          </span>
        ) : clip.analysed && clip.mood ? (
          <>
            <span
              className="flex-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: MOOD_COLOR[clip.mood] }}
            >
              {clip.mood}
            </span>
            {clip.stress_index != null && (
              <>
                <span className="hidden h-1 w-12 shrink-0 overflow-hidden rounded-full bg-raised sm:block">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.min(100, clip.stress_index)}%`,
                      background: MOOD_COLOR[clip.mood],
                    }}
                  />
                </span>
                <span className="mono w-6 shrink-0 text-right text-[11px] text-ink-secondary">
                  {Math.round(clip.stress_index)}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="flex-1 text-[11px] text-ink-muted">Not scored — click to run</span>
        )}
      </button>
    </li>
  )
}
