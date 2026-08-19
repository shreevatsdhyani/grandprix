import { useEffect, useRef, useState } from 'react'

/**
 * Custom-styled audio player matching the dark theme.
 * Replaces native browser controls with cyan accents and dark styling.
 */

interface Props {
  src: string
  onError?: () => void
  className?: string
}

export function CustomAudioPlayer({ src, onError, className = '' }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [showVolume, setShowVolume] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleDurationChange = () => setDuration(audio.duration)
    const handleEnded = () => setPlaying(false)
    const handleError = () => onError?.()

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('durationchange', handleDurationChange)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [onError])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (playing) {
      audio.pause()
    } else {
      audio.play()
    }
    setPlaying(!playing)
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return

    const rect = e.currentTarget.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    audio.currentTime = percent * duration
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    const newVolume = parseFloat(e.target.value)
    if (audio) {
      audio.volume = newVolume
      setVolume(newVolume)
    }
  }

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`rounded-xl border border-hairline bg-raised/80 p-3 ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-[2.5px] border-white bg-accent-cyan/10 text-white transition hover:bg-accent-cyan/25"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Progress Bar */}
        <div className="flex flex-1 flex-col gap-1.5">
          {/* Cyan elapsed bar on a light track — the track carries the
              visibility so the empty remainder is readable without taking the
              bar itself off the cyan accent. */}
          <div
            className="h-1.5 cursor-pointer overflow-hidden rounded-full"
            style={{ background: 'rgba(255, 255, 255, 0.14)' }}
            onClick={handleSeek}
            role="slider"
            aria-valuenow={currentTime}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-label="Seek"
          >
            <div
              className="h-full rounded-full bg-accent-cyan transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Time Display — elapsed reads brighter than the total, so the live
              number is the one the eye lands on. */}
          <div className="mono flex justify-between text-[10px]">
            <span style={{ color: '#C5CCD6' }}>{formatTime(currentTime)}</span>
            <span style={{ color: '#98A2B3' }}>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume Control */}
        <div
          className="relative"
          onMouseEnter={() => setShowVolume(true)}
          onMouseLeave={() => setShowVolume(false)}
        >
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-secondary transition hover:bg-white/5 hover:text-ink-primary"
            aria-label="Volume"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              {volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
              {volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
            </svg>
          </button>

          {showVolume && (
            <div className="absolute bottom-full right-0 mb-2 rounded-lg border border-hairline bg-panel p-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-surface [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-cyan"
                aria-label="Volume level"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
