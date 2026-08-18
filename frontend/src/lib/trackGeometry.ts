/**
 * Placing a point on a circuit outline from a fraction of a lap.
 *
 * The paths in `circuits.ts` are the fastest race lap's GPS trace, arc-length
 * resampled to an even point density and normalised into a 1000-unit box. Even
 * arc-length spacing is the property that makes this cheap: point *i* of *n* sits
 * at fraction *i/n* of the way round the lap, so a driver 42.8% into a lap is at
 * point 0.428n. No re-integration of distance, no lookup table.
 *
 * Regenerate the paths with `backend/scripts/extract_circuits.py` if the cached
 * session list changes; if that script ever stops resampling by arc length, this
 * mapping silently becomes wrong (points would cluster where the car was slow).
 */

export interface Point {
  x: number
  y: number
}

/** Parse the `M x y L x y L x y … Z` paths emitted by extract_circuits.py. */
export function parsePath(path: string): Point[] {
  const nums = path.match(/-?\d+(?:\.\d+)?/g)
  if (!nums) return []
  const pts: Point[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: Number(nums[i]), y: Number(nums[i + 1]) })
  }
  return pts
}

/**
 * The coordinate at a fraction of the way round the lap.
 *
 * `fraction` is clamped into [0, 1) and wraps, because a lap is a loop and a
 * value of exactly 1 is the start line, not a point past the end.
 */
export function pointAtFraction(points: Point[], fraction: number): Point | null {
  if (points.length === 0) return null
  const f = ((fraction % 1) + 1) % 1
  const exact = f * points.length
  const i = Math.floor(exact)
  const a = points[i % points.length]
  const b = points[(i + 1) % points.length]
  const t = exact - i
  // Linear interpolation between neighbours. The points are dense enough (~460
  // for a 5km lap, so ~13m apart) that this is well under the accuracy of the
  // distance figure it is placing.
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Outward-facing normal at a fraction, for pushing labels clear of the track. */
export function normalAtFraction(points: Point[], fraction: number): Point {
  if (points.length < 2) return { x: 0, y: -1 }
  const f = ((fraction % 1) + 1) % 1
  const i = Math.floor(f * points.length)
  const a = points[i % points.length]
  const b = points[(i + 1) % points.length]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular to the direction of travel. Which side is "outward" varies
  // around the loop; for label offsets either side reads fine, and picking
  // consistently keeps the labels from crossing the track.
  return { x: -dy / len, y: dx / len }
}
