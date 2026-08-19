import { useMemo } from 'react'
import type { ContextDomain, Finding, FindingsResponse, Urgency } from '../types'
import { URGENCY_COLOR } from '../lib/mood'

/**
 * The LLM's ranked reading of the whole session.
 *
 * Deliberately shaped to look *different* from StrategyCalls, because it is a
 * different kind of claim. StrategyCalls are rules firing — same input, same
 * output, every time. These are written by a language model over the fused data,
 * so the panel carries its provenance openly: which model wrote it, which data
 * domains it could see, how confident it says it is, and how many of its findings
 * were thrown away for citing data we do not hold.
 *
 * Ranked by actionability rather than severity, so rank 1 is not necessarily the
 * scariest row. The rank badge and the severity rail therefore encode different
 * things and both are labelled in words.
 */

/** Severity in words. The colour rail must never be the only signal (CVD). */
const SEVERITY_WORD: Record<Urgency, string> = {
  critical: 'Cost the race',
  warning: 'Act on this',
  info: 'Worth knowing',
}

/** Short labels for the domain chips. Long enough to be unambiguous. */
const DOMAIN_LABEL: Record<ContextDomain, string> = {
  stress: 'voice',
  pace: 'pace',
  track: 'track',
  tyre: 'tyre',
  position: 'on-lap',
  situation: 'race',
  radio: 'radio',
}

function confidenceWord(c: number): string {
  if (c >= 0.75) return 'high confidence'
  if (c >= 0.5) return 'moderate confidence'
  return 'low confidence'
}

function FindingRow({
  finding,
  onSelectLap,
}: {
  finding: Finding
  onSelectLap?: (lap: number) => void
}) {
  const color = URGENCY_COLOR[finding.severity]
  return (
    <li className="overflow-hidden rounded-lg border border-hairline bg-raised">
      <div className="flex">
        <span className="w-1 shrink-0" style={{ background: color }} aria-hidden />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className="mono shrink-0 rounded px-1.5 py-0.5 text-[10px] text-plane"
              style={{ background: color }}
            >
              {finding.rank}
            </span>
            <span className="tower text-ink-muted" style={{ fontSize: 11 }}>
              {SEVERITY_WORD[finding.severity]}
            </span>
            <span className="mono text-[10px] text-ink-muted">
              {confidenceWord(finding.confidence)}
            </span>
          </div>

          <p className="mt-1.5 text-sm font-medium leading-snug text-ink">{finding.headline}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{finding.detail}</p>

          {/* Laps are validated server-side before they reach here, so making
              them navigation targets cannot dead-end the user. */}
          {finding.laps.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mono text-[10px] text-ink-muted">laps</span>
              {finding.laps.map((lap) => (
                <button
                  key={lap}
                  onClick={() => onSelectLap?.(lap)}
                  className="mono rounded border border-hairline px-1.5 py-0.5 text-[11px] text-ink transition hover:border-hairline-bright"
                  aria-label={`Go to lap ${lap}`}
                >
                  {lap}
                </button>
              ))}
            </div>
          )}

          {finding.evidence.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {finding.evidence.map((e, i) => (
                <li key={i} className="mono text-[10px] leading-relaxed text-ink-muted">
                  · {e}
                </li>
              ))}
            </ul>
          )}

          {finding.domains.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {finding.domains.map((d) => (
                <span
                  key={d}
                  className="mono rounded-full border border-hairline px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-muted"
                >
                  {DOMAIN_LABEL[d] ?? d}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function TopFindings({
  findings,
  loading,
  error,
  onSelectLap,
  onRefresh,
}: {
  findings: FindingsResponse | null
  loading: boolean
  error: string | null
  onSelectLap?: (lap: number) => void
  onRefresh?: () => void
}) {
  const hasTyre = useMemo(
    () => findings?.findings.some((f) => f.domains.includes('tyre')) ?? false,
    [findings],
  )

  return (
    <section className="panel flex flex-col p-4 sm:p-5" aria-label="Top findings">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="card-title">Top findings</h2>
        <div className="flex items-baseline gap-2">
          {findings && (
            <span className="mono text-[11px] text-ink-muted">
              {findings.findings.length} finding{findings.findings.length === 1 ? '' : 's'}
            </span>
          )}
          {onRefresh && !loading && (
            <button
              onClick={onRefresh}
              className="mono text-[10px] text-ink-muted underline decoration-dotted transition hover:text-ink"
            >
              regenerate
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        Written by a language model over the fused race data, ranked by what to act on first.
        Distinct from the rule-based calls below, which are reproducible.
      </p>

      {loading && (
        <p className="mt-3 text-sm text-ink-muted">
          Reading the session across voice, pace, track, tyre and race data…
        </p>
      )}

      {!loading && error && (
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Findings unavailable — {error}
        </p>
      )}

      {!loading && !error && findings && findings.findings.length === 0 && (
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          No findings survived checking. Every candidate cited data this session does not
          contain, so none are shown rather than showing claims we cannot verify.
        </p>
      )}

      {!loading && !error && findings && findings.findings.length > 0 && (
        <>
          <ol className="mt-3 space-y-2">
            {findings.findings.map((f) => (
              <FindingRow key={f.rank} finding={f} onSelectLap={onSelectLap} />
            ))}
          </ol>

          {/* Provenance. Kept visible rather than tucked behind a tooltip: these
              are model-written claims and the reader is entitled to know it. */}
          <div className="mt-3 space-y-1 border-t border-hairline pt-2.5">
            {hasTyre && (
              <p className="text-[10px] leading-relaxed text-ink-muted">
                Tyre figures are <span className="mono">modelled</span> from compound, age and
                lap-time trend. No public source has real F1 tyre temperature, pressure or wear.
              </p>
            )}
            {findings.dropped_findings > 0 && (
              <p className="text-[10px] leading-relaxed text-ink-muted">
                {findings.dropped_findings} further finding
                {findings.dropped_findings === 1 ? ' was' : 's were'} discarded for citing laps or
                data this session does not contain.
              </p>
            )}
            <p className="mono text-[9px] leading-relaxed text-ink-muted">
              {findings.model}
              {findings.cached && ' · cached'}
              {findings.context_domains.length > 0 &&
                ` · saw ${findings.context_domains.map((d) => DOMAIN_LABEL[d] ?? d).join(', ')}`}
            </p>
          </div>
        </>
      )}
    </section>
  )
}
