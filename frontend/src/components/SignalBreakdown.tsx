import { clamp } from '../lib/format'
import { tint } from '../lib/mood'
import type { ClipAnalysis, ScoringMode } from '../types'

/**
 * The three branches feeding the fusion head, shown as contributions rather than
 * hidden inside one number. Explainability is a judged criterion, and this panel
 * is also the visual argument for why one model isn't enough: the acoustic branch
 * routinely disagrees with the other two on fatigue.
 *
 * In SINGLE mode the fused answer comes from the acoustic branch alone, so the
 * other two are dimmed and said to be non-contributing. Showing three confident
 * bars there would fake exactly the claim the SINGLE/FUSION toggle exists to let
 * a judge disprove.
 *
 * Captions name pitch, energy and articulation rate because that is the branch's
 * feature list, not its evidence: `speech_rate_z` is 0.0 in every cached result
 * (no word timings from the STT model) and the fitted head learned a coefficient
 * of exactly 0.0 for it. Nothing here claims articulation rate moved the score.
 */

const ROWS = [
  {
    key: 'prosody' as const,
    label: 'Prosody',
    colour: 'var(--cyan)',
    caption: 'Pitch, energy and articulation rate against this driver’s own baseline',
  },
  {
    key: 'acoustic' as const,
    label: 'Acoustic',
    colour: 'var(--mag)',
    caption: 'Pretrained speech-emotion model, listening to tone alone',
  },
  {
    key: 'text' as const,
    label: 'Transcript',
    colour: 'var(--grn)',
    caption: 'Emotion read from the words themselves',
  },
]

interface Props {
  clip: ClipAnalysis | null
  mode: ScoringMode
}

export function SignalBreakdown({ clip, mode }: Props) {
  // Only worth dimming once there are real numbers to dim; with no clip on
  // screen the panel's whole job is to teach what the three branches are.
  const single = clip != null && mode === 'naive'

  return (
    <section className="panel flex flex-col" style={{ padding: 20 }} aria-label="Signal breakdown">
      <h2 className="panel-title">Why It Scored That Way</h2>

      {!clip && (
        <p className="text-[12.5px] font-normal leading-[1.5] text-t2" style={{ marginTop: 10 }}>
          These are the three branches every call is scored on. The breakdown fills in once you
          select one.
        </p>
      )}

      {single && (
        <p
          className="text-[11.5px] font-normal leading-[1.45] text-t2"
          style={{
            marginTop: 10,
            padding: '7px 10px',
            background: tint('var(--mag)', 9),
            borderLeft: '2px solid var(--mag)',
            borderRadius: 3,
          }}
        >
          Single-model mode: the answer above came from the acoustic branch alone. Prosody and
          transcript are shown for comparison only — neither is contributing to it.
        </p>
      )}

      {/* This panel and the baseline share a 1fr 1fr row and trade places for
          which one is taller as the column narrows and the prose rewraps, so it
          has to absorb the stretch too: the three branches share whatever height
          the grid hands over rather than banking it under the last caption. */}
      <div className="flex flex-1 flex-col justify-between" style={{ marginTop: 16, gap: 14 }}>
        {ROWS.map((row) => {
          const score = clip ? clip.signals[row.key].score : null
          const dimmed = single && row.key !== 'acoustic'
          return (
            <div key={row.key} style={dimmed ? { opacity: 0.45 } : undefined}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    style={{ width: 8, height: 8, borderRadius: 1, background: row.colour }}
                    aria-hidden
                  />
                  <span className="text-[13px] font-medium leading-none text-t1">{row.label}</span>
                </span>
                <span className="mono text-[14px] font-semibold leading-none text-t1">
                  {score != null ? Math.round(score) : '—'}
                </span>
              </div>

              <div
                style={{
                  marginTop: 7,
                  height: 5,
                  background: 'var(--s3)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                {score != null && (
                  <div
                    role="meter"
                    aria-valuenow={Math.round(score)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.label}: ${Math.round(score)} of 100`}
                    style={{
                      height: '100%',
                      background: row.colour,
                      borderRadius: 3,
                      // Clamped because a branch that overshoots 100 would paint
                      // past the track and there is no visible ceiling to notice.
                      width: `${clamp(score, 0, 100)}%`,
                    }}
                  />
                )}
              </div>

              <p
                className="text-[11px] font-normal leading-[1.4] text-t3"
                style={{ marginTop: 6 }}
              >
                {row.caption}
              </p>
            </div>
          )
        })}
      </div>

      {/* The audit trail: the emotion model's own word, in its own vocabulary,
          next to the id of the checkpoint that produced it. When it says "sad"
          and the fused answer says Tired, the whole case for fusion is one line
          of readable evidence rather than a claim. */}
      <p
        className="text-[11px] font-normal leading-[1.5] text-t3"
        style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}
      >
        {clip ? (
          <>
            The speech-emotion model’s own label for this call was{' '}
            <span className="text-t2" style={{ fontWeight: 600 }}>
              {clip.signals.acoustic.top_label}
            </span>{' '}
            — check the fused answer against it. Raw output from{' '}
            <span className="mono text-t2">{clip.signals.acoustic.model_id}</span>.
          </>
        ) : (
          <>
            Once a call is selected this line names the raw label the speech-emotion model returned
            and the checkpoint id it came from, so the fused answer can be checked against the
            model’s own words.
          </>
        )}
      </p>
    </section>
  )
}
