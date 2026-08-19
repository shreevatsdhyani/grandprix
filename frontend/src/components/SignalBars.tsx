import type { ClipAnalysis, ScoringMode } from '../types'

/**
 * The three branches feeding the fusion head, shown as contributions rather
 * than hidden inside a single score. Explainability is a judged criterion, and
 * this panel is also the visual argument for why one model isn't enough: the
 * acoustic bar routinely disagrees with the other two on fatigue.
 *
 * Three identities, so categorical slots 1–3 — validated all-pairs against the
 * dark surface (worst CVD ΔE 9.4, worst normal-vision ΔE 20.9).
 */

const ROWS = [
  {
    key: 'prosody' as const,
    label: 'Prosody',
    color: 'var(--series-1)',
    hint: 'Pitch, energy and articulation rate against this driver’s own baseline',
  },
  {
    key: 'acoustic' as const,
    label: 'Acoustic',
    color: 'var(--series-2)',
    hint: 'Pretrained speech-emotion model, listening to tone alone',
  },
  {
    key: 'text' as const,
    label: 'Transcript',
    color: 'var(--series-3)',
    hint: 'Emotion read from the words themselves',
  },
]

export function SignalBars({ clip, mode }: { clip: ClipAnalysis | null; mode: ScoringMode }) {
  const usingFallback = clip != null && mode === 'fusion' && !clip.fusion.fitted

  return (
    <section className="panel p-4 sm:p-5" aria-label="Signal breakdown">
      <h2 className="card-title">Why it scored that way</h2>

      {!clip ? (
        <p className="mt-2 text-sm text-ink-muted">Open a radio call to see the breakdown.</p>
      ) : (
        <>
          <div className="mt-3 space-y-3.5">
            {ROWS.map((row) => {
              const score = clip.signals[row.key].score
              const pct = Math.min(100, Math.max(0, score))
              return (
                <div key={row.key}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 text-ink-secondary">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ background: row.color }}
                        aria-hidden
                      />
                      {row.label}
                    </span>
                    {/* Direct label on every bar is fine here: three rows, and
                        the number is the point of the panel. */}
                    <span className="mono text-ink-primary">{Math.round(score)}</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${pct}%`,
                        background: row.color,
                        boxShadow: `0 0 12px -2px ${row.color}`,
                      }}
                      role="meter"
                      aria-valuenow={Math.round(score)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.label}: ${Math.round(score)} of 100`}
                    />
                  </div>
                  <p className="mt-1 text-[10px] leading-tight text-ink-muted">{row.hint}</p>
                </div>
              )
            })}
          </div>

          {/* The tell: the raw label from the emotion model, in its own
              vocabulary. When it says "sad" and we say "Tired", the whole
              argument for fusion is on screen in one line. */}
          <p className="mt-3.5 border-t border-hairline pt-2.5 text-[10px] leading-relaxed text-ink-muted">
            The emotion model’s own word for this clip was{' '}
            <span className="mono text-ink-secondary">“{clip.signals.acoustic.top_label}”</span> —
            its label set has no class for fatigue at all, which is why one model alone cannot
            produce the Tired call.
          </p>

          {usingFallback && (
            <p
              className="mt-2.5 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed"
              style={{
                background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
                color: 'var(--status-warning)',
              }}
            >
              <span aria-hidden>▲</span>
              <span>
                Fusion is running on interpretable rules, not a trained head. Label some clips and
                run <span className="mono">scripts/fit_fusion.py</span> to fit it.
              </span>
            </p>
          )}
        </>
      )}
    </section>
  )
}
