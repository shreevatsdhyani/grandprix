import { useState } from 'react'
import { Helmet } from './Helmet'
import { portraitUrl } from '../lib/drivers'
import type { Driver } from '../lib/drivers'

/**
 * Who is in the car.
 *
 * The portrait is a real photograph rather than an avatar because the claim on
 * the right of it is about a person under pressure, and a monogram undercuts
 * that. All 23 images are freely-licensed Wikimedia files served from `public/`
 * — no press imagery, and nothing fetched at runtime.
 *
 * When one fails to load the drawn helmet stands in. That path is not
 * theoretical: a code that appears in the race data but has no card still has to
 * render something, and a broken `<img>` icon is the most obviously unfinished
 * thing a screen can show.
 */

export function DriverPlate({ driver }: { driver: Driver }) {
  const [portraitFailed, setPortraitFailed] = useState(false)
  const src = portraitUrl(driver.code)
  const showPortrait = src != null && !portraitFailed

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-s2 p-5">
      {/* Papaya fading out to the right, so the card reads as the start of the
          row rather than as a box sitting beside one. */}
      <span
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: 'linear-gradient(90deg, var(--pap), transparent)' }}
        aria-hidden
      />

      <div className="flex items-start gap-[18px]">
        <div className="relative h-[132px] w-[104px] flex-none">
          {showPortrait ? (
            <img
              src={src}
              alt={`${driver.first} ${driver.last}`}
              width={104}
              height={132}
              className="h-full w-full rounded-md object-cover"
              onError={() => setPortraitFailed(true)}
            />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-md bg-s3">
              <Helmet driver={driver} size={104} />
            </div>
          )}

          {/* Overlapping the portrait's corner the way a car number overlaps the
              bodywork. `.cut` is the single-diagonal number-board shape. */}
          {driver.number > 0 && (
            <span
              className="cut mono absolute -bottom-2.5 -left-2.5 px-2 py-1.5 text-[20px] font-bold leading-none text-ink"
              style={{
                background: 'var(--pap)',
                boxShadow: '0 6px 16px -8px var(--pap)',
              }}
            >
              {driver.number}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[3px] pt-1.5">
          <span className="flex items-center gap-2">
            {/* The livery swatch carries the team colour; the name stays cyan.
                --team is a raw livery hex and several of them (Williams' light
                blue, Mercedes' aqua) fall below reading contrast on the light
                theme's white card, so colour identifies the team and a
                theme-aware token carries the text. */}
            <span
              className="h-[7px] w-[7px] flex-none rounded-[1px]"
              style={{ background: 'var(--team)' }}
              aria-hidden
            />
            <span className="truncate font-cond text-[9.5px] font-semibold uppercase leading-none tracking-[0.2em] text-cyan">
              {driver.team.name}
            </span>
          </span>

          {driver.first && (
            <span className="mt-1.5 text-[14px] leading-[1.1] text-t2">{driver.first}</span>
          )}

          <h2 className="font-cond text-[34px] font-bold uppercase leading-none tracking-[0.03em] text-t1">
            {driver.last}
          </h2>
        </div>
      </div>
    </div>
  )
}
