import type { Mood, Urgency } from '../types'

/**
 * How mood and urgency look, in one place.
 *
 * Every panel that draws a mood — library rows, chart markers, the readout, the
 * strategy cards — reads from here. When this lived inline in three components
 * they drifted, and a reader who learned "magenta means tired" on the chart
 * found it meant something else in the list.
 *
 * Colour never carries mood on its own. Red/green separate by only ΔE 4.1 for a
 * deuteranope, so every use pairs the colour with the mood word, and on chart
 * marks with a distinct shape as well.
 */

export const MOOD_COLOR: Record<Mood, string> = {
  Calm: 'var(--grn)',
  Stressed: 'var(--yel)',
  Tired: 'var(--mag)',
}

/** The secondary encoding that makes mood readable without colour. */
export const MOOD_SHAPE: Record<Mood, 'circle' | 'triangle' | 'square'> = {
  Calm: 'circle',
  Stressed: 'triangle',
  Tired: 'square',
}

/**
 * The faint wash behind the selected clip's readout.
 *
 * `color-mix` rather than a literal rgba, because --grn and friends are
 * re-picked in the light theme (--yel moves as far as #B98A00) and a hardcoded
 * wash would keep the dark theme's hue against a white card.
 */
export const moodWash = (mood: Mood): string =>
  `color-mix(in srgb, ${MOOD_COLOR[mood]} 13%, transparent)`

/** A tint of any token — tinted borders, bar tracks, caveat panels. */
export const tint = (color: string, pct: number): string =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`

export const URGENCY_COLOR: Record<Urgency, string> = {
  info: 'var(--cyan)',
  warning: 'var(--yel)',
  critical: 'var(--mag)',
}

/**
 * What the tag on a strategy card says.
 *
 * Not the `code` — the headline already opens with that ("HOLD — driver
 * venting…"), so repeating it wastes the one place on the card that can tell a
 * reader whether this needs acting on now.
 */
export const URGENCY_TAG: Record<Urgency, string> = {
  info: 'NOTE',
  warning: 'WARNING',
  critical: 'ACT NOW',
}

/**
 * SVG marker for a mood, centred on (cx, cy).
 *
 * Sizes are the design's: a circle at r=5, a triangle 12px across the base, a
 * 10px square. They read as the same visual weight, which matters because the
 * shape is doing real work here, not decorating.
 */
export function moodMarker(
  mood: Mood,
  cx: number,
  cy: number,
): { shape: 'circle'; r: number } | { shape: 'polygon'; points: string } {
  switch (MOOD_SHAPE[mood]) {
    case 'circle':
      return { shape: 'circle', r: 5 }
    case 'triangle':
      return {
        shape: 'polygon',
        points: `${cx} ${cy - 6.5},${cx + 6} ${cy + 4.5},${cx - 6} ${cy + 4.5}`,
      }
    case 'square':
      return {
        shape: 'polygon',
        points: `${cx - 5} ${cy - 5},${cx + 5} ${cy - 5},${cx + 5} ${cy + 5},${cx - 5} ${cy + 5}`,
      }
  }
}
