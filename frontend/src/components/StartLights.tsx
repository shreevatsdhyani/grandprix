import { useEffect, useState } from 'react'

/**
 * The loading state, as the start gantry.
 *
 * Every wait in this app is the same wait — a race session being pulled and
 * scored — so it gets one recognisable signal rather than a different spinner
 * per panel. Five lamps illuminate left to right, then go out together, which
 * is the one loading animation an F1 audience already knows how to read.
 *
 * Driven from state rather than staggered CSS delays: the lamps must all
 * extinguish on the same frame, and percentage keyframes with per-lamp delays
 * cannot express that.
 */

interface Props {
  /** What is being fetched, in the interface's voice. */
  label: string
  detail?: string
  /** `inline` drops the gantry into a panel; `page` centres it in the viewport. */
  variant?: 'page' | 'inline'
}

const LAMPS = [0, 1, 2, 3, 4]
const STEP_MS = 380

export function StartLights({ label, detail, variant = 'page' }: Props) {
  // 0–5 lights the lamps in sequence; 6 is the dark beat before it repeats.
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 7), STEP_MS)
    return () => clearInterval(id)
  }, [])

  const scale = variant === 'page' ? 1 : 0.62

  return (
    <div
      className={
        variant === 'page'
          ? 'flex flex-col items-center justify-center gap-6 py-20 sm:py-28'
          : 'flex flex-col items-center justify-center gap-3 py-8'
      }
      role="status"
      aria-live="polite"
    >
      <Gantry step={step} scale={scale} />

      <div className="text-center">
        <p
          className="tower text-ink-primary"
          style={{ fontSize: variant === 'page' ? 22 : 15, letterSpacing: '0.06em' }}
        >
          {label}
        </p>
        {detail && (
          <p className="mt-1.5 text-xs text-ink-muted sm:text-[13px]">{detail}</p>
        )}
      </div>
    </div>
  )
}

function Gantry({ step, scale }: { step: number; scale: number }) {
  const w = 78 * scale
  const gap = 10 * scale
  const r = 24 * scale

  return (
    <div
      className="flex items-end"
      style={{ gap }}
      aria-hidden
    >
      {LAMPS.map((i) => {
        const lit = step > i && step <= LAMPS.length
        return (
          <div
            key={i}
            className="flex flex-col items-center rounded-xl border"
            style={{
              width: w,
              padding: 8 * scale,
              gap: 7 * scale,
              borderColor: 'var(--edge)',
              background: 'linear-gradient(180deg, #1b1f27 0%, #0b0d12 100%)',
              boxShadow: lit
                ? '0 0 34px -6px rgba(255,32,60,0.65), 0 1px 0 rgba(255,255,255,0.06) inset'
                : '0 1px 0 rgba(255,255,255,0.04) inset',
              transition: 'box-shadow 180ms ease',
            }}
          >
            {[0, 1].map((row) => (
              <span
                key={row}
                style={{
                  width: r,
                  height: r,
                  borderRadius: '50%',
                  transition: 'background 140ms ease, box-shadow 140ms ease',
                  background: lit
                    ? 'radial-gradient(circle at 34% 30%, #ff8b9f 0%, #ff1633 42%, #a2001a 100%)'
                    : 'radial-gradient(circle at 34% 30%, #23262e 0%, #14161b 60%, #0a0b0e 100%)',
                  boxShadow: lit
                    ? '0 0 16px rgba(255,26,58,0.9), 0 0 3px rgba(255,255,255,0.55) inset'
                    : '0 1px 2px rgba(0,0,0,0.8) inset',
                }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Placeholder rows for lists that are refetching.
 *
 * A list that empties while it reloads reads as "there is nothing here"; these
 * hold the shape so it reads as "this is coming back".
 */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-7 rounded-md bg-raised anim-pulse"
          style={{ animationDelay: `${i * 90}ms`, opacity: 1 - i * 0.09 }}
        />
      ))}
    </div>
  )
}
