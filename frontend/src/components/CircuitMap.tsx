import { useId } from 'react'
import type { Circuit } from '../lib/circuits'

/**
 * The venue, as the venue actually is.
 *
 * The outline is the fastest race lap's GPS trace from the cached FastF1
 * position data, so changing Grand Prix genuinely redraws Silverstone into
 * Monza rather than swapping a label. Two cars run the lap as light streaks —
 * a moving dash along the same path, which is the one thing on this page that
 * is decoration, and it earns its place by making the venue switch legible from
 * across a room.
 *
 * Depth is a stack of offset copies of the path rather than a 3D library: the
 * shape is a closed loop lying flat, so an extrusion plus a plane tilt is the
 * whole of the geometry, and it costs nothing to animate.
 */

interface Props {
  circuit: Circuit
  /** Livery colour of the driver on screen. */
  color: string
  /** `hero` tilts onto a ground plane; `flat` stays face-on for small sizes. */
  variant?: 'hero' | 'flat'
  className?: string
}

const EXTRUSION = [7, 6, 5, 4, 3, 2, 1]

export function CircuitMap({ circuit, color, variant = 'hero', className }: Props) {
  const uid = useId().replace(/:/g, '')
  const { path, height } = circuit

  return (
    <div
      className={className}
      style={
        variant === 'hero'
          ? {
              transform: 'perspective(1100px) rotateX(52deg) rotateZ(-14deg)',
              transformStyle: 'preserve-3d',
            }
          : undefined
      }
      aria-hidden
    >
      <svg
        viewBox={`-30 -30 1060 ${height + 60}`}
        width="100%"
        height="100%"
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <linearGradient id={`${uid}-streak`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>
          <filter id={`${uid}-bloom`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Kerb slab: successive copies stepped upward read as the thickness of
            the track surface once the plane is tilted. */}
        {EXTRUSION.map((dy, i) => (
          <path
            key={dy}
            d={path}
            transform={`translate(0 ${dy})`}
            fill="none"
            stroke="#05070a"
            strokeWidth={19}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.4 + i * 0.08}
          />
        ))}

        {/* Asphalt, its kerb edge, then the racing line in the driver's livery. */}
        <path
          d={path}
          fill="none"
          stroke="#2b323d"
          strokeWidth={19}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={path}
          fill="none"
          stroke="#12161d"
          strokeWidth={13}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeOpacity={0.55}
          strokeWidth={4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Two cars on the lap. pathLength normalises the dash maths so every
            circuit runs at the same visual speed regardless of its real length. */}
        <g filter={`url(#${uid}-bloom)`}>
          <path
            className="gp-car"
            d={path}
            pathLength={1000}
            fill="none"
            stroke={color}
            strokeWidth={13}
            strokeLinecap="round"
            style={{ ['--gp-lap-delay' as string]: '0s' }}
          />
          <path
            className="gp-car gp-car--chase"
            d={path}
            pathLength={1000}
            fill="none"
            stroke="#ffffff"
            strokeWidth={7}
            strokeLinecap="round"
            style={{ ['--gp-lap-delay' as string]: '-2.6s' }}
          />
        </g>
      </svg>
    </div>
  )
}
