import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, MouseEvent } from 'react'
import { clamp, clock } from '../lib/format'

/**
 * The inline player row.
 *
 * Native `<audio>` controls are drawn by the platform and cannot be themed, and
 * on a 400px sidebar Chrome's bar alone is taller than this whole row. So the
 * element stays for the decoding and the seeking, and only its chrome is
 * replaced.
 *
 * There is no volume control on purpose: the OS and the browser tab both have
 * one already, and the popover that used to live here spent its whole life
 * rendering transparent against a colour token that no longer existed.
 */

/** Button (34px) plus the row's 11px padding and 1px border on each side. The
 *  error state has to hold this exact height or the card jumps under the mouse
 *  when a clip's audio is missing. */
const ROW_H = 58

interface Props {
  src: string
  /** `duration_s` from the API. The element reports nothing until metadata
   *  arrives, so without this the total reads 0:00 for the first few hundred
   *  milliseconds of every clip. */
  durationHint?: number
}

export function CustomAudioPlayer({ src, durationHint }: Props): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setPosition(audio.currentTime)
    // `duration` is NaN before metadata and Infinity on a stream; either one
    // would poison every percentage downstream of it.
    const onDurationChange = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onEnded = () => {
      setPlaying(false)
      setPosition(0)
    }
    const onError = () => {
      setFailed(true)
      setPlaying(false)
    }
    // Taken from the element rather than toggled optimistically on click: a
    // rejected play() left the old player showing a pause glyph over silence.
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [])

  // Selecting another clip swaps `src` on the same element, which keeps the old
  // position and the old failure on screen until the new file loads.
  useEffect(() => {
    setPosition(0)
    setDuration(0)
    setFailed(false)
  }, [src])

  // The element's own duration wins once it has one — the API's `duration_s` is
  // rounded and can disagree with the decoded file by a few tenths.
  const total = duration > 0 ? duration : (durationHint ?? 0)
  const pct = total > 0 ? clamp((position / total) * 100, 0, 100) : 0

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => setFailed(true))
    else audio.pause()
  }

  function seekTo(seconds: number) {
    const audio = audioRef.current
    if (!audio || total <= 0) return
    const next = clamp(seconds, 0, total)
    audio.currentTime = next
    setPosition(next)
  }

  function handleTrackClick(e: MouseEvent<HTMLButtonElement>) {
    // A keyboard activation arrives as a click with detail 0 and clientX 0,
    // which would read as a seek to the very start.
    if (e.detail === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    seekTo(((e.clientX - rect.left) / rect.width) * total)
  }

  function handleTrackKey(e: KeyboardEvent<HTMLButtonElement>) {
    // 2s steps, not the usual 5s: these clips run 4–20 seconds, so a 5s arrow
    // press would cross most of one.
    const step = 2
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        seekTo(position - step)
        break
      case 'ArrowRight':
      case 'ArrowUp':
        seekTo(position + step)
        break
      case 'Home':
        seekTo(0)
        break
      case 'End':
        seekTo(total)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div
      className="flex items-center gap-3 rounded-[7px] border border-line bg-s2 px-[13px] py-[11px]"
      style={{ minHeight: ROW_H }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {failed ? (
        <p className="text-[11px] font-normal leading-[1.4] text-t3">
          This clip’s audio could not be loaded. The analysis below still stands — only the
          recording is missing from disk.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause clip' : 'Play clip'}
            className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full border border-line2 text-[11px] text-t1 transition-[border-color,color] duration-[160ms] hover:border-pap hover:text-pap"
          >
            {/* U+FE0E asks for the text glyph: bare U+25B6 is drawn by the
                emoji font on Windows, which lands a blue triangle in a papaya
                UI. */}
            <span aria-hidden>{playing ? '❚❚' : '▶︎'}</span>
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
            <button
              type="button"
              onClick={handleTrackClick}
              onKeyDown={handleTrackKey}
              // The design's 3px track is a 3px pointer target, so an invisible
              // ::after pads the hit area out to 19px without redrawing it.
              className="relative h-[3px] w-full cursor-pointer rounded-[2px] bg-s3 after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
              role="slider"
              aria-label="Seek within clip"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(position)}
              aria-valuetext={`${clock(position)} of ${clock(total)}`}
            >
              <span
                className="block h-full rounded-[2px] bg-pap"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </button>

            <div className="mono flex justify-between text-[10px] font-normal leading-none text-t3">
              <span>{clock(position)}</span>
              <span>{clock(total)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
