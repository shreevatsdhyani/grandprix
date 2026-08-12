import type { PipelineStage, ProgressEvent } from '../types'

/**
 * Stage-by-stage inference progress.
 *
 * The point of this panel is evidentiary, not decorative. A 13-second silent
 * "Analysing…" button is indistinguishable from a fixture replay with a
 * setTimeout, and "is your backend real?" is the question a judge actually wants
 * answered. Watching STT sit for four seconds and the three signal branches tick
 * past in order is the answer.
 *
 * One subtlety in the backend contract: `ProgressEvent` has no `status` field.
 * A stage is emitted when it *starts* (pipeline/run.py calls emit() before doing
 * the work), so completion is inferred — a stage is done once a later stage has
 * arrived. `elapsed_ms` is cumulative from socket open, so per-stage duration is
 * the difference between consecutive events.
 */

/** Emission order in pipeline/run.py. `align` is included: the plan's mockup
 *  omitted it, but the backend does emit it and a list that stalls at 7/8 with
 *  no explanation looks like a hang. */
const STAGES: { stage: PipelineStage; label: string }[] = [
  { stage: 'preprocess', label: 'Preprocess' },
  { stage: 'vad', label: 'Isolate speech' },
  { stage: 'stt', label: 'Transcribe' },
  { stage: 'prosody', label: 'Prosody' },
  { stage: 'acoustic', label: 'Acoustic emotion' },
  { stage: 'text', label: 'Transcript emotion' },
  { stage: 'fusion', label: 'Fusion' },
  { stage: 'align', label: 'Align to laps' },
]

interface Props {
  /** Every event received so far, in arrival order. */
  events: ProgressEvent[]
  /** True while the socket is open; drives the spinner on the active stage. */
  running: boolean
}

export function PipelineProgress({ events, running }: Props) {
  if (!events.length && !running) return null

  const finished = events.some((e) => e.stage === 'done')

  // Index of the furthest stage reached. Events for stages not in STAGES
  // (`done`, `error`) are ignored here — they are handled as terminal states.
  let reached = -1
  const startedAt = new Map<PipelineStage, number>()
  for (const event of events) {
    const i = STAGES.findIndex((s) => s.stage === event.stage)
    if (i === -1) continue
    if (!startedAt.has(event.stage)) startedAt.set(event.stage, event.elapsed_ms)
    if (i > reached) reached = i
  }

  const total = events.at(-1)?.elapsed_ms ?? 0
  const activeMessage = !finished ? events.at(-1)?.message : undefined

  return (
    <div
      className="mb-3 rounded border border-hairline bg-raised px-3 py-2.5"
      aria-label="Inference progress"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="card-title">
          {finished ? 'Inference complete' : 'Running inference'}
        </span>
        <span className="tabular text-[10px] text-ink-muted">
          {(total / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Screen readers get the stage name, not eight silently-mutating rows.
          Sighted users get the list; both get the same information. */}
      <p className="sr-only" aria-live="polite">
        {finished
          ? `Analysis complete in ${(total / 1000).toFixed(1)} seconds`
          : activeMessage}
      </p>

      <ol className="space-y-1">
        {STAGES.map(({ stage, label }, i) => {
          // Done when a later stage has arrived, or the run finished entirely.
          const done = finished || i < reached
          const active = !finished && i === reached
          const startMs = startedAt.get(stage)
          const nextStart = STAGES.slice(i + 1)
            .map((s) => startedAt.get(s.stage))
            .find((v) => v != null)
          const endMs = nextStart ?? (finished ? total : undefined)
          const durationMs =
            startMs != null && endMs != null ? endMs - startMs : undefined

          return (
            <li key={stage} className="flex items-center gap-2 text-[11px] leading-tight">
              {/* Glyph carries the state, never colour alone — the status
                  red/green pair fails CVD separation. */}
              <span
                className="inline-flex w-3 shrink-0 justify-center"
                style={{
                  color: done
                    ? 'var(--status-good)'
                    : active
                      ? 'var(--series-2)'
                      : 'var(--text-muted)',
                }}
                aria-hidden
              >
                {done ? (
                  '✓'
                ) : active ? (
                  <span className="inline-block h-2 w-2 animate-spin rounded-sm border border-current border-t-transparent motion-reduce:animate-none" />
                ) : (
                  '·'
                )}
              </span>

              <span
                className={
                  done
                    ? 'flex-1 text-ink-secondary'
                    : active
                      ? 'flex-1 font-semibold text-ink-primary'
                      : 'flex-1 text-ink-muted'
                }
              >
                {label}
              </span>

              <span className="tabular text-[10px] text-ink-muted">
                {durationMs != null
                  ? `${(durationMs / 1000).toFixed(1)}s`
                  : active
                    ? 'running…'
                    : ''}
              </span>
            </li>
          )
        })}
      </ol>

      {activeMessage && (
        <p className="mt-2 border-t border-hairline pt-1.5 text-[10px] leading-snug text-ink-muted">
          {activeMessage}
        </p>
      )}
    </div>
  )
}
