import type { ReactNode } from 'react'
import type { Driver } from '../lib/drivers'
import type { DriverBaseline } from '../types'

/**
 * What the stress score is measured against.
 *
 * Small, and low on the page, but it is the difference between "this driver
 * sounds loud" and "this driver sounds loud *for them*" — so it names which of
 * the three references is actually in play rather than implying the best case.
 *
 * Two traps live in the payload and both used to reach the screen as confident
 * numbers:
 *
 *   • `f0_mean` and `rms_mean` are means of z-scores, not Hz and not linear RMS,
 *     despite the names. Every label here carries (Z); none of them says Hz.
 *   • `speech_rate` is 0.00 for every driver in the dataset. prosody.py only
 *     computes it from word timings, and the STT model has no alignment heads,
 *     so `transcript.words` is empty in all 853 cached results. Printing 0.00
 *     claims a measurement that was never taken, so the cell says "unmeasured".
 */

interface Props {
  baseline: DriverBaseline | null
  driver: Driver
}

export function BaselinePanel({ baseline, driver }: Props) {
  // getDriver() falls back to `last: code`, so this is never empty even for a
  // driver we have no card for.
  const name = driver.last

  const prose = !baseline
    ? `No calm calls have been scored for ${name} yet, so there is no personal reference to measure against. The score falls back to population priors — fixed defaults that fit any voice and none in particular — which is a materially weaker claim than “loud for him”.`
    : baseline.source === 'driver'
      ? `Every score on this page is measured against ${name}’s own calm radio, not against the grid. That is what stops a naturally loud driver reading as permanently stressed, and a quiet one getting a free pass: the question is never “is this loud”, it is “is this loud for him”.`
      : baseline.source === 'cohort'
        ? `There are too few calm calls from ${name} to calibrate him individually, so the reference is the pooled cohort — every driver’s calm radio at once. It still separates loud from stressed, but it measures him against the grid’s normal rather than his own.`
        : `The reference is population priors — fixed defaults, not ${name} and not this grid. Nothing here is individually calibrated, so read the score as an indication rather than a measurement: a naturally loud voice will run hotter than it should.`

  const reference = !baseline
    ? 'population priors'
    : baseline.source === 'driver'
      ? `${name}’s own calm calls`
      : baseline.source === 'cohort'
        ? 'pooled cohort'
        : 'population priors'

  return (
    <section
      className="panel grid grid-cols-1 gap-6 sm:grid-cols-[1fr_200px]"
      style={{ padding: 20 }}
      aria-label="Scored against"
    >
      <div className="flex flex-col">
        <h2 className="panel-title">Scored Against</h2>

        <p className="text-[13px] font-normal leading-[1.55] text-t2" style={{ marginTop: 12 }}>
          {prose}
        </p>

        {/* Pinned to the foot of the column. This panel shares a 1fr 1fr row with
            the signal breakdown and is stretched to whichever is taller, so the
            reference chip takes the slack rather than leaving 90px of blank card
            under the prose. */}
        <div className="mt-4 flex flex-1 items-end">
          <div
            className="inline-flex items-center gap-2"
            style={{
              padding: '7px 11px',
              background: 'var(--glass)',
              border: '1px solid var(--line)',
              borderRadius: 4,
            }}
          >
            <span className="eyebrow-sm">REFERENCE</span>
            <span className="mono text-[11.5px] font-medium leading-none text-pap">
              {reference}
            </span>
          </div>
        </div>
      </div>

      {/* The rule turns into a top rule when the grid collapses, so the stats
          always read as a separate column of instrumentation. */}
      {/* justify-between with a gap floor: the gap is the minimum spacing, and any
          height the grid hands this column beyond that gets shared between the
          four readings instead of piling up at the bottom. */}
      <div className="flex flex-col justify-between gap-3 border-t border-line pt-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
        <Stat
          label="BASELINE CLIPS"
          title="Calm calls the reference was computed from."
          value={baseline ? String(baseline.n_baseline_clips) : '—'}
        />
        <Stat
          label="MEAN PITCH (Z)"
          title="Mean of per-clip pitch z-scores against the reference. Standard deviations, not Hz."
          value={baseline ? baseline.f0_mean.toFixed(2) : '—'}
        />
        <Stat
          label="MEAN ENERGY (Z)"
          title="Mean of per-clip loudness z-scores against the reference. Standard deviations, not linear RMS."
          value={baseline ? baseline.rms_mean.toFixed(3) : '—'}
        />
        <Stat
          label="SPEECH RATE (Z)"
          title="The STT model returns no word timings, so transcript.words is empty for every clip and articulation rate cannot be computed. The payload's 0.00 is an absence, not a reading."
          note="no word timings from the STT model"
        >
          {/* Not a number, so not .mono, and deliberately not 0.00. */}
          {baseline ? (
            <span className="text-[12.5px] font-normal leading-none text-t3">unmeasured</span>
          ) : (
            <span className="mono text-[15px] font-medium leading-none text-t1">—</span>
          )}
        </Stat>
      </div>
    </section>
  )
}

function Stat({
  label,
  title,
  value,
  note,
  children,
}: {
  label: string
  title: string
  value?: string
  note?: string
  children?: ReactNode
}) {
  return (
    <div title={title}>
      <div className="eyebrow-sm">{label}</div>
      <div style={{ marginTop: 6 }}>
        {children ?? (
          <span className="mono text-[15px] font-medium leading-none text-t1">{value}</span>
        )}
      </div>
      {note && (
        <div className="text-[10px] font-normal leading-[1.35] text-t3" style={{ marginTop: 4 }}>
          {note}
        </div>
      )}
    </div>
  )
}
