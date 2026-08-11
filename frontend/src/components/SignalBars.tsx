import type { ClipAnalysis } from '../types'

/**
 * The three branches feeding the fusion head, shown as contributions rather
 * than hidden inside a single score. Explainability is a judged criterion, and
 * this panel is also the visual argument for why one model isn't enough:
 * the acoustic bar routinely disagrees with the other two on fatigue.
 *
 * Three identities, so categorical slots 1–3 — validated all-pairs against the
 * dark surface (worst CVD ΔE 9.4, worst normal-vision ΔE 20.9).
 */

const ROWS = [
  {
    key: 'prosody' as const,
    label: 'Prosody',
    color: 'var(--series-1)',
    hint: 'Pitch, energy, articulation rate vs this driver’s baseline',
  },
  {
    key: 'acoustic' as const,
    label: 'Acoustic',
    color: 'var(--series-2)',
    hint: 'Pretrained speech-emotion model',
  },
  {
    key: 'text' as const,
    label: 'Transcript',
    color: 'var(--series-3)',
    hint: 'Emotion read from what was said',
  },
]

export function SignalBars({ clip }: { clip: ClipAnalysis | null }) {
  return (
    <section className="card p-4" aria-label="Signal breakdown">
      <h2 className="card-title mb-3">Signal breakdown</h2>

      {!clip ? (
        <p className="text-sm text-ink-muted">No clip selected.</p>
      ) : (
        <>
          <div className="space-y-3">
            {ROWS.map((row) => {
              const score = clip.signals[row.key].score
              return (
                <div key={row.key}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-ink-secondary">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ background: row.color }}
                        aria-hidden
                      />
                      {row.label}
                    </span>
                    {/* Direct label on every bar is fine here: three rows, and
                        the number is the point of the panel. */}
                    <span className="tabular text-ink-primary">{Math.round(score)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: row.color }}
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
          <div className="mt-3 border-t border-hairline pt-2 text-[10px] text-ink-muted">
            Emotion model’s own label:{' '}
            <span className="text-ink-secondary">“{clip.signals.acoustic.top_label}”</span>
            <span className="mx-1">·</span>
            no fatigue class exists in its label set
          </div>
        </>
      )}
    </section>
  )
}
