import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { clamp } from '../lib/format'

/**
 * The start gantry, as the acknowledgement that a re-analysis is running.
 *
 * The sequence is deliberately shorter than the work: five lights and a ramp
 * finish in ~2.2s, the real socket takes ~13s. The lights answer "did my click
 * land", which has to be instant; the stage list beside them reports actual
 * progress, which cannot be faked into 2.2s. So the bar holding at LIGHTS OUT
 * while stages keep arriving is the intended reading, not a stall — which is
 * why the caption switches to a completed state rather than freezing at 99%.
 *
 * Split into a dumb view plus a driver hook because the panel that hosts it
 * also hosts the live stage list, and mixing five timers into that component
 * made every render of the transcript re-enter the animation logic.
 */

const LIGHT_COUNT = 5

/** Design timings. The first light is late enough to read as a response to the
 *  click rather than as part of the same frame. */
const FIRST_LIGHT_MS = 140
const LIGHT_STEP_MS = 150
const RAMP_DELAY_MS = 280
const RAMP_MS = 1200

/** How long a finished sequence stays on screen. Without it the block vanishes
 *  on the same frame the socket closes and the reader never sees it complete. */
const HOLD_MS = 420

interface Props {
  /** How many of the five lights are on, 0–5. */
  lit: number
  /** 0–100. */
  progress: number
  label: string
}

export function StartLights({ lit, progress, label }: Props): JSX.Element {
  const pct = clamp(progress, 0, 100)

  return (
    <div className="rounded-[6px] border border-line bg-s2 p-3">
      {/* Five coloured divs say nothing to a screen reader, so they are hidden
          and the bar below carries the whole state. */}
      <div className="flex justify-center gap-1.5" aria-hidden>
        {Array.from({ length: LIGHT_COUNT }, (_, i) => (
          <span
            key={i}
            className="h-[9px] w-full rounded-[2px]"
            style={{
              background: i < lit ? 'var(--mag)' : 'var(--s3)',
              transition: 'background .12s linear',
            }}
          />
        ))}
      </div>

      <div
        className="mt-2.5 h-[5px] overflow-hidden rounded-[3px] bg-s3"
        role="progressbar"
        aria-label="Scoring progress"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={label}
      >
        <div className="stripe h-full" style={{ width: `${pct}%`, transition: 'width .1s linear' }} />
      </div>

      <p className="mono mt-2 text-center text-[10px] font-normal leading-none text-t3">{label}</p>
    </div>
  )
}

/**
 * True when the reader has asked the OS to stop animations.
 *
 * Guarded for a missing `window` even though this app never renders on a
 * server: the same guard is what keeps it safe under a test runner with a
 * partial DOM, which is where this would otherwise throw.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface LightState {
  lit: number
  progress: number
  label: string
  visible: boolean
}

export function useStartLights(running: boolean): LightState {
  const [lit, setLit] = useState(0)
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!running) {
      const hide = window.setTimeout(() => {
        setVisible(false)
        setLit(0)
        setProgress(0)
      }, HOLD_MS)
      return () => window.clearTimeout(hide)
    }

    setVisible(true)

    if (prefersReducedMotion()) {
      setLit(LIGHT_COUNT)
      setProgress(100)
      return
    }

    setLit(0)
    setProgress(0)

    const timers: number[] = []
    let frame = 0

    for (let i = 1; i <= LIGHT_COUNT; i++) {
      timers.push(
        window.setTimeout(() => setLit(i), FIRST_LIGHT_MS + (i - 1) * LIGHT_STEP_MS),
      )
    }

    // rAF rather than a short interval: the ramp is a 1.2s width animation, and
    // a 10ms timer both drifts and keeps firing when the tab is backgrounded.
    const rampAt = FIRST_LIGHT_MS + (LIGHT_COUNT - 1) * LIGHT_STEP_MS + RAMP_DELAY_MS
    timers.push(
      window.setTimeout(() => {
        const started = performance.now()
        const step = (now: number) => {
          const next = clamp(((now - started) / RAMP_MS) * 100, 0, 100)
          setProgress(next)
          if (next < 100) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      }, rampAt),
    )

    // The user switches clip constantly, so this effect is torn down mid-ramp
    // far more often than it runs to completion. A surviving rAF loop would go
    // on calling setState on an unmounted panel.
    return () => {
      for (const id of timers) window.clearTimeout(id)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [running])

  // Rounded before the comparison, so the caption can never read "SCORING ·
  // 100%" on the last frame before it flips.
  const shown = Math.round(progress)

  return {
    lit,
    progress,
    visible,
    label: shown < 100 ? `SCORING · ${shown}%` : 'LIGHTS OUT · COMPLETE',
  }
}
