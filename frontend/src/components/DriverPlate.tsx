import { useRef, useState } from 'react'
import type { Driver } from '../lib/drivers'
import { portraitUrl } from '../lib/drivers'
import { Helmet } from './Helmet'

/**
 * Who is on screen, in one glance.
 *
 * The rest of the app speaks in three-letter codes, which is correct for a
 * dense table and useless as an anchor — HAM and HUL are the same screen with
 * two letters changed. This plate is the one place the driver is a person: the
 * face, the full name, the car number, the team, and the helmet.
 *
 * The name is set the way a broadcast lower-third sets it — given name small
 * above, family name at signage size below — because that fits a 330px column
 * without truncating anybody, including Hülkenberg and Verstappen.
 *
 * It re-mounts on every driver change (keyed by code upstream) so the entrance
 * animation replays. That is the change confirmation: you can tell from across
 * the room that the page is showing someone else.
 */

const TILT = 5

export function DriverPlate({ driver }: { driver: Driver }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null)
  const [portraitFailed, setPortraitFailed] = useState(false)

  const portrait = portraitUrl(driver.code)
  const showPortrait = portrait != null && !portraitFailed

  // Pointer parallax only. Touch gets nothing: there is no hover to recover
  // from, and a plate stuck at an angle after a tap looks broken.
  function handleMove(e: React.PointerEvent) {
    if (e.pointerType !== 'mouse') return
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setTilt({
      x: (0.5 - (e.clientY - box.top) / box.height) * TILT * 2,
      y: ((e.clientX - box.left) / box.width - 0.5) * TILT * 2,
    })
  }

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={() => setTilt(null)}
      className="anim-wipe relative overflow-hidden rounded-xl border border-hairline"
      style={{
        background:
          'linear-gradient(155deg, color-mix(in srgb, var(--team) 17%, #12151b) 0%, #0b0d12 64%)',
        transform: tilt
          ? `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`
          : undefined,
        transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.07) inset, 0 26px 50px -30px rgba(0,0,0,1)',
      }}
    >
      {/* Livery edge and the one-shot broadcast flare across it. */}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'var(--team)' }} />
      <div
        className="anim-flare pointer-events-none absolute inset-y-0 left-0 w-full"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--team) 42%, transparent) 55%, transparent 100%)',
        }}
      />

      <div className="relative flex h-full items-center gap-4 p-4 sm:p-5">
        <div className="relative shrink-0">
          {showPortrait ? (
            <img
              src={portrait}
              alt={`${driver.first} ${driver.last}`}
              width={104}
              height={104}
              loading="eager"
              onError={() => setPortraitFailed(true)}
              className="h-[92px] w-[92px] rounded-xl object-cover sm:h-[104px] sm:w-[104px]"
              // Faces sit above centre in these press photos, so the crop is
              // biased up rather than centred.
              style={{
                objectPosition: '50% 16%',
                boxShadow:
                  '0 0 0 2px color-mix(in srgb, var(--team) 70%, transparent), 0 14px 28px -14px #000',
              }}
            />
          ) : (
            <Helmet driver={driver} size={104} />
          )}

          {/* Car number, worn on the corner of the portrait the way it sits on
              the nose of the car. */}
          {driver.number > 0 && (
            <span
              className="tower absolute -bottom-2 -left-2 grid h-8 min-w-[34px] place-items-center rounded-md px-1.5"
              style={{
                fontSize: 19,
                background: 'var(--team)',
                color: driver.team.ink,
                boxShadow: '0 0 20px -6px color-mix(in srgb, var(--team) 80%, transparent)',
              }}
            >
              {driver.number}
            </span>
          )}

        </div>

        <div className="min-w-0 flex-1">
          <p
            className="eyebrow leading-tight"
            style={{ color: 'var(--team)', letterSpacing: '0.14em' }}
          >
            {driver.team.name}
          </p>

          {driver.first && (
            <p className="mt-1.5 text-[13px] font-medium leading-none text-ink-secondary">
              {driver.first}
            </p>
          )}

          {/* Condensed, and never broken across lines. HÜLKENBERG and
              VERSTAPPEN are ten characters and have to fit beside a portrait in
              a 380px column, which the display face at any readable size does
              not — the timing-tower width does. */}
          <h2
            className="tower mt-1.5 uppercase text-ink-primary"
            style={{
              fontSize: 'clamp(24px, 2.5vw, 34px)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'clip',
            }}
            title={`${driver.first} ${driver.last}`}
          >
            {driver.last}
          </h2>
        </div>
      </div>
    </div>
  )
}
