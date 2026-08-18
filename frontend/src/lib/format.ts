/** Small formatters shared across panels. Each one exists because getting it
 *  wrong in a single place produced a visibly wrong number on screen. */

/**
 * 'GB' from '🇬🇧'.
 *
 * A flag emoji is two regional-indicator codepoints, and those are just the ISO
 * 3166-1 alpha-2 letters offset by U+1F1E6 - 'A'. So the two-letter chip the
 * header wants is already in the circuit data and doesn't need a second table
 * to fall out of sync with.
 */
export function flagToCode(flag: string | undefined): string | null {
  if (!flag) return null
  const pts = [...flag].map((c) => c.codePointAt(0) ?? 0)
  if (pts.length !== 2 || pts.some((p) => p < 0x1f1e6 || p > 0x1f1ff)) return null
  return pts.map((p) => String.fromCharCode(p - 0x1f1e6 + 65)).join('')
}

/**
 * How long the analysis took, or nothing.
 *
 * `processing_ms` reaches 4,739,960 — 79 minutes — in the cached batch results,
 * because a batch run measured wall-clock across a queue rather than per clip.
 * Printing that raw reads as a catastrophic latency figure next to a model name.
 * Anything over a minute is a batch artifact, not a measurement, so it is
 * dropped and only "cached" survives.
 */
export function formatLatency(ms: number, cached: boolean): string | null {
  const plausible = Number.isFinite(ms) && ms > 0 && ms < 60_000
  if (plausible && cached) return `${Math.round(ms)}ms · cached`
  if (plausible) return `${Math.round(ms)}ms`
  return cached ? 'cached' : null
}

/** 'L37', or an em dash for a clip whose lap the index never recorded. */
export const lapLabel = (lap: number | null | undefined): string =>
  lap != null ? `L${lap}` : '—'

/** '0:07' — clip durations and player positions. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/** 'BOX NOW' from 'BOX_NOW'. */
export const humanCode = (code: string): string => code.replace(/_/g, ' ')
