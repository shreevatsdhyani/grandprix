import { useMemo } from 'react'
import type { Circuit } from '../lib/circuits'

/**
 * The track, drawn faintly behind the hero.
 *
 * This is the real GPS trace of the fastest race lap, not an illustration — but
 * it is deliberately at 16% opacity and behind the headline, because its job is
 * to tell a reader *where* they are at a glance, not to be read. A stronger
 * version of this competed with the 46px claim sitting on top of it and won,
 * which is the wrong outcome.
 *
 * `vectorEffect="non-scaling-stroke"` is what keeps the line 2px: the paths are
 * authored in a 1000-unit box and drawn into a 420px one, so a plain
 * `stroke-width` of 2 would render at 0.8px and disappear on a dark ground.
 */

/** Room for the stroke's round caps, which sit half a width outside the geometry. */
const PAD = 8

export function CircuitMap({ circuit }: { circuit: Circuit }) {
  const box = useMemo(() => viewBox(circuit.path, circuit.height), [circuit.path, circuit.height])

  return (
    /* The frame, and the only thing here with a height.

       An <svg> is a replaced element, so `height:auto` resolves off its own
       intrinsic aspect ratio and not off the box it sits in: giving the svg
       `inset-y-2` directly set both edges and it ignored them, sizing itself to
       420 × ratio — 717px tall for Monza, five times the hero, painting the
       trace straight through the KPI strip below. A plain div does obey top and
       bottom, so the height lands here and `h-full` on the svg inherits a
       definite one. */
    <div
      className="pointer-events-none absolute inset-y-2 right-2 w-[420px] overflow-hidden"
      aria-hidden
    >
      <svg
        viewBox={box}
        /* Pinned right, not centred. `extract_circuits.py` normalises every trace
           into a 1000-wide box but preserves the aspect ratio, so a tall circuit
           only fills part of that width — Monaco is 780 of 1000, Monza 580.
           Centring the letterboxed result walked the trace left until it crossed
           under the 46px headline as a stray scribble. Anchoring it to the right
           edge keeps the empty side of the box on the side where the text is. */
        preserveAspectRatio="xMaxYMid meet"
        className="anim-fin h-full w-full opacity-[0.16]"
      >
        <path
          d={circuit.path}
          fill="none"
          stroke="var(--pap)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

/**
 * The trace's own bounding box, read off the path data.
 *
 * `Circuit` records the normalised height but not the width, and using the full
 * 1000 units leaves up to 22% of the viewBox empty — which is dead space the
 * layout then has to absorb somewhere. The paths are `M`/`L`/`Z` only, so every
 * number in them is one coordinate of an x,y pair and a bounding box is a scan
 * rather than a parse. 460 points, once per circuit.
 */
function viewBox(d: string, height: number): string {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 4) return `0 0 1000 ${height}`

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i])
    const y = Number(nums[i + 1])
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const w = maxX - minX
  const h = maxY - minY
  if (!(w > 0) || !(h > 0)) return `0 0 1000 ${height}`

  return `${minX - PAD} ${minY - PAD} ${w + PAD * 2} ${h + PAD * 2}`
}
