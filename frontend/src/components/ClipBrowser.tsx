import { useEffect, useState } from 'react'
import { getLibrary } from '../api'
import type { ClipSummary } from '../types'
import { MOOD_COLOR } from '../types'

/**
 * The brief's first deliverable: "play *or* upload a radio clip."
 *
 * Upload was already built. This is the play half. Without it the 446 curated
 * clips on disk were completely unreachable from the UI — the timeline only
 * lists clips that already have a cached analysis, so an empty results/ meant
 * an empty timeline and no way to play anything. This component bypasses that:
 * it shows clips by lap order regardless of whether they are analysed yet.
 *
 * Selecting a clip calls onSelect with the clip_id. The parent handles the rest
 * (trigger analysis via WS if not yet analysed, or just play from cache).
 */
interface Props {
  sessionId: string
  driver: string
  selectedClipId: string | null
  onSelect: (clipId: string) => void
}

export function ClipBrowser({ sessionId, driver, selectedClipId, onSelect }: Props) {
  const [clips, setClips] = useState<ClipSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    getLibrary(sessionId, driver)
      .then(setClips)
      .catch(() => setClips([]))
      .finally(() => setLoading(false))
  }, [sessionId, driver])

  if (loading) {
    return (
      <section className="card p-4" aria-label="Clip browser">
        <h2 className="card-title mb-2">Radio clips</h2>
        <p className="text-xs text-ink-muted">Loading…</p>
      </section>
    )
  }

  if (!clips.length) {
    return (
      <section className="card p-4" aria-label="Clip browser">
        <h2 className="card-title mb-2">Radio clips</h2>
        <p className="text-xs text-ink-muted">No clips indexed for this driver.</p>
      </section>
    )
  }

  const analysed = clips.filter((c) => c.analysed).length

  return (
    <section className="card flex flex-col p-4" aria-label="Clip browser">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="card-title">Radio clips</h2>
        <span className="text-[10px] text-ink-muted tabular">
          {analysed}/{clips.length} analysed
        </span>
      </div>

      <ul className="max-h-[320px] overflow-y-auto space-y-0.5 pr-1">
        {clips.map((c) => {
          const active = c.clip_id === selectedClipId
          return (
            <li key={c.clip_id}>
              <button
                onClick={() => onSelect(c.clip_id)}
                className={[
                  'w-full rounded px-2 py-1.5 text-left text-[11px] transition',
                  active
                    ? 'bg-brand/20 text-ink-primary'
                    : 'hover:bg-raised text-ink-secondary',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono tabular">
                    {c.lap != null ? `L${c.lap}` : '—'}
                  </span>

                  {c.analysed && c.mood ? (
                    <span
                      className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                      style={{ color: MOOD_COLOR[c.mood], opacity: 0.9 }}
                    >
                      {c.mood}
                    </span>
                  ) : (
                    <span className="text-[9px] text-ink-muted">unanalysed</span>
                  )}

                  {c.analysed && c.stress_index != null && (
                    <span className="tabular text-[10px] text-ink-muted">
                      {Math.round(c.stress_index)}
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
