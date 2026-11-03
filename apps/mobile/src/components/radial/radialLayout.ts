/** A tool in a radial menu. */
export interface RadialItem {
  key: string
  /** One or two characters drawn in the petal. */
  glyph: string
  /** Read out by screen readers and shown in the caption while the petal is touched. */
  label: string
  glyphStyle?: 'bold' | 'italic' | 'plain'
  tone?: 'normal' | 'danger' | 'active'
  disabled?: boolean
  /** Stays open after a tap, for tools used several times in a row (undo, redo). */
  repeatable?: boolean
}

export interface Point {
  x: number
  y: number
}

export interface PlacedPetal extends RadialItem, Point {
  size: number
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/**
 * Spreads items evenly along an arc. Angles are in degrees with 0 pointing right and 90 up, so
 * an arc from 90 to 180 is the quarter circle above and to the left of the origin.
 */
export function layoutArc(
  origin: Point,
  items: RadialItem[],
  ring: { radius: number; from: number; to: number; size: number }
): PlacedPetal[] {
  const step = items.length > 1 ? (ring.to - ring.from) / (items.length - 1) : 0
  return items.map((item, index) => {
    const angle = toRadians(items.length > 1 ? ring.from + step * index : (ring.from + ring.to) / 2)
    return {
      ...item,
      size: ring.size,
      x: origin.x + ring.radius * Math.cos(angle),
      y: origin.y - ring.radius * Math.sin(angle)
    }
  })
}

/**
 * Blooms items around a touch point, opening towards the middle of the screen so no petal is
 * hidden under the screen edge or the finger, then nudges any that still fall outside.
 */
export function layoutAround(
  origin: Point,
  items: RadialItem[],
  bounds: { width: number; height: number },
  options: { radius?: number; size?: number; margin?: number } = {}
): PlacedPetal[] {
  const radius = options.radius ?? 104
  const size = options.size ?? 54
  const margin = options.margin ?? 12
  const towards =
    (Math.atan2(-(bounds.height / 2 - origin.y), bounds.width / 2 - origin.x) * 180) / Math.PI
  // Wide enough that neighbouring petals never touch, and never a full circle.
  const spread = Math.min(260, Math.max(120, (items.length - 1) * 38))
  const petals = layoutArc(origin, items, {
    radius,
    size,
    from: towards - spread / 2,
    to: towards + spread / 2
  })
  const half = size / 2 + margin
  return petals.map((petal) => ({
    ...petal,
    x: Math.min(bounds.width - half, Math.max(half, petal.x)),
    y: Math.min(bounds.height - half, Math.max(half, petal.y))
  }))
}

/** The petal under a finger, if any; the target is a little larger than the drawn petal. */
export function petalAt(petals: PlacedPetal[], point: Point, slack = 1.3): PlacedPetal | null {
  let best: PlacedPetal | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const petal of petals) {
    if (petal.disabled) continue
    const distance = Math.hypot(petal.x - point.x, petal.y - point.y)
    if (distance <= (petal.size / 2) * slack && distance < bestDistance) {
      best = petal
      bestDistance = distance
    }
  }
  return best
}
