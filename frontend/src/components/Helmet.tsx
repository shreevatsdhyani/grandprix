import { useId } from 'react'
import type { Driver } from '../lib/drivers'

/**
 * Driver identity, drawn rather than fetched.
 *
 * A photograph is the obvious answer and the wrong one here: the demo has to
 * run with no network, and licensed press images cannot ship in the repo. A
 * helmet is the other thing an F1 audience recognises instantly, and in each
 * driver's own three colours it does the same job — HAM reads yellow, VER reads
 * navy-and-red — while staying a few kilobytes of vector.
 */

const SHELL =
  'M24 122C20 84 36 46 70 27C100 11 146 9 176 26C204 42 219 70 221 100L221 130' +
  'C221 156 206 171 182 175L94 189C57 194 28 163 24 122Z'

const VISOR =
  'M92 66C122 47 166 47 196 64C207 70 212 82 210 95C208 108 196 114 180 114' +
  'L110 111C96 110 88 101 88 89C88 79 88 71 92 66Z'

/** The plane of the chin bar, which turns away from the light. */
const CHIN = 'M148 116C180 119 208 114 221 103L221 130C221 156 206 171 182 175L146 180Z'

export function Helmet({ driver, size = 132 }: { driver: Driver; size?: number }) {
  const uid = useId().replace(/:/g, '')
  const [shell, stripe, accent] = driver.helmet

  return (
    <svg
      viewBox="0 0 244 214"
      width={size}
      height={(size * 214) / 244}
      role="img"
      aria-label={`${driver.first} ${driver.last} — helmet colours`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <clipPath id={`${uid}-s`}>
          <path d={SHELL} />
        </clipPath>

        {/* Clear-coat: a broad highlight up top, a dark roll underneath. That
            pairing is what separates a glossy lid from a flat sticker. */}
        <linearGradient id={`${uid}-gloss`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.4" />
          <stop offset="34%" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="70%" stopColor="#000" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>

        {/* Soft, so the chin plane turns rather than showing a seam. */}
        <linearGradient id={`${uid}-chin`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>

        <linearGradient id={`${uid}-visor`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#66788a" stopOpacity="0.95" />
          <stop offset="28%" stopColor="#151b23" />
          <stop offset="100%" stopColor="#05070a" />
        </linearGradient>

        <radialGradient id={`${uid}-flash`} cx="0.3" cy="0.2" r="0.5">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Contact shadow, so the helmet sits on the plate instead of floating. */}
      <ellipse cx="124" cy="199" rx="88" ry="10" fill="#000" opacity="0.5" />

      <g clipPath={`url(#${uid}-s)`}>
        <path d={SHELL} fill={shell} />
        {/* Livery: one broad band over the crown and a narrow accent beneath —
            the layout most modern lids actually use. */}
        <path d="M14 96C62 56 128 38 232 56" fill="none" stroke={stripe} strokeWidth="28" />
        <path d="M14 122C62 86 128 66 232 84" fill="none" stroke={accent} strokeWidth="10" />
        <path d={CHIN} fill={`url(#${uid}-chin)`} />
        <path d={SHELL} fill={`url(#${uid}-gloss)`} />
        <ellipse cx="88" cy="54" rx="54" ry="30" fill={`url(#${uid}-flash)`} />
      </g>

      {/* Visor aperture, its rubber seal, and the tear-off highlight. */}
      <path d={VISOR} fill={`url(#${uid}-visor)`} />
      <path
        d="M96 64C124 46 166 46 198 63"
        fill="none"
        stroke="#0b0e13"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M110 68C132 57 164 57 190 68"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.28"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Chin vent. */}
      <path d="M176 134L214 128L214 146L176 152Z" fill="#0b0e13" opacity="0.85" />
      <path
        d="M182 137L210 132M182 144L210 139"
        stroke="#39414d"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <path d={SHELL} fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="2.5" />
    </svg>
  )
}
