import type { Point, Stroke } from './types'

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function pathLength(stroke: Stroke): number {
  let total = 0
  for (let i = 1; i < stroke.length; i++) total += dist(stroke[i - 1]!, stroke[i]!)
  return total
}

export function bbox(strokes: Stroke[]): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes)
    for (const p of s) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

export const mapStrokes = (strokes: Stroke[], f: (p: Point) => Point): Stroke[] =>
  strokes.map((s) => s.map(f))

export const translate = (strokes: Stroke[], dx: number, dy: number): Stroke[] =>
  mapStrokes(strokes, (p) => ({ x: p.x + dx, y: p.y + dy }))

/** Points evenly spaced by arc length, endpoints preserved. */
export function resampleBySpacing(stroke: Stroke, spacing: number): Stroke {
  if (stroke.length < 2) return stroke.map((p) => ({ ...p }))
  const total = pathLength(stroke)
  const count = Math.max(1, Math.round(total / spacing))
  return resampleByCount(stroke, count + 1)
}

/** Exactly `count` points evenly spaced by arc length. */
export function resampleByCount(stroke: Stroke, count: number): Stroke {
  if (stroke.length === 0) return []
  if (stroke.length === 1 || count < 2) return Array.from({ length: Math.max(1, count) }, () => ({ ...stroke[0]! }))
  const total = pathLength(stroke)
  if (total === 0) return Array.from({ length: count }, () => ({ ...stroke[0]! }))
  const out: Stroke = [{ ...stroke[0]! }]
  const step = total / (count - 1)
  let travelled = 0
  let target = step
  for (let i = 1; i < stroke.length && out.length < count - 1; i++) {
    const a = stroke[i - 1]!
    const b = stroke[i]!
    const seg = dist(a, b)
    while (seg > 0 && travelled + seg >= target - 1e-9 && out.length < count - 1) {
      const t = (target - travelled) / seg
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      target += step
    }
    travelled += seg
  }
  out.push({ ...stroke[stroke.length - 1]! })
  return out
}

/** Ramer-Douglas-Peucker. Drops points that sit within `epsilon` of the simplified line. */
export function simplify(stroke: Stroke, epsilon: number): Stroke {
  if (stroke.length < 3) return stroke.slice()
  const keep = new Uint8Array(stroke.length)
  keep[0] = 1
  keep[stroke.length - 1] = 1
  const stack: Array<[number, number]> = [[0, stroke.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    const a = stroke[first]!
    const b = stroke[last]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    let worst = -1
    let worstDistance = epsilon
    for (let i = first + 1; i < last; i++) {
      const p = stroke[i]!
      const d = len === 0 ? dist(p, a) : Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len
      if (d > worstDistance) {
        worstDistance = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([first, worst], [worst, last])
    }
  }
  return stroke.filter((_, i) => keep[i])
}

/** Signed turn at vertex i in degrees. Positive is counter-clockwise. */
export function turnAt(stroke: Stroke, i: number): number {
  const a = stroke[i - 1]
  const b = stroke[i]
  const c = stroke[i + 1]
  if (!a || !b || !c) return 0
  const ux = b.x - a.x, uy = b.y - a.y
  const vx = c.x - b.x, vy = c.y - b.y
  if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) return 0
  return (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI
}

const isClosed = (stroke: Stroke): boolean =>
  stroke.length > 3 && dist(stroke[0]!, stroke[stroke.length - 1]!) < 1e-6

/**
 * Catmull-Rom interpolation through the points of a coarse polyline, broken at
 * any vertex that turns more sharply than `cornerDegrees`. Curves get smooth,
 * real corners stay corners.
 */
export function smoothThrough(stroke: Stroke, cornerDegrees: number, spacing: number): Stroke {
  if (stroke.length < 3) return resampleBySpacing(stroke, spacing)
  const closed = isClosed(stroke)
  const pts = closed ? stroke.slice(0, -1) : stroke
  const n = pts.length
  const at = (i: number): Point => (closed ? pts[((i % n) + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!)
  const corner = (i: number): boolean => {
    if (!closed && (i <= 0 || i >= n - 1)) return true
    const ring = [at(i - 1), at(i), at(i + 1)]
    return Math.abs(turnAt(ring, 1)) > cornerDegrees
  }

  const out: Stroke = []
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const p1 = at(i)
    const p2 = at(i + 1)
    // At a corner the neighbour on the far side is ignored, which makes the
    // tangent point straight along the segment.
    const p0 = corner(i) ? p1 : at(i - 1)
    const p3 = corner(i + 1) ? p2 : at(i + 2)
    const steps = Math.max(1, Math.round(dist(p1, p2) / spacing))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  out.push(closed ? { ...out[0]! } : { ...pts[n - 1]! })
  return out
}

/**
 * Pulls every interior point toward the midpoint of its neighbours. A few
 * passes round off corners; many passes melt the shape. Endpoints stay put,
 * and a closed loop is treated as a ring.
 */
export function relax(stroke: Stroke, strength: number, passes: number): Stroke {
  if (stroke.length < 3 || strength <= 0 || passes <= 0) return stroke.map((p) => ({ ...p }))
  const closed = isClosed(stroke)
  let pts = (closed ? stroke.slice(0, -1) : stroke).map((p) => ({ ...p }))
  const n = pts.length
  for (let pass = 0; pass < passes; pass++) {
    const next = pts.map((p) => ({ ...p }))
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue
      const a = pts[(i - 1 + n) % n]!
      const b = pts[(i + 1) % n]!
      next[i] = {
        x: pts[i]!.x + strength * ((a.x + b.x) / 2 - pts[i]!.x),
        y: pts[i]!.y + strength * ((a.y + b.y) / 2 - pts[i]!.y),
      }
    }
    pts = next
  }
  if (closed) pts.push({ ...pts[0]! })
  return pts
}

/** Scales strokes about their own bounding box so it matches `target`. */
export function fitToBox(strokes: Stroke[], target: Box): Stroke[] {
  const b = bbox(strokes)
  if (!b) return strokes
  const sx = b.maxX - b.minX > 1e-6 ? (target.maxX - target.minX) / (b.maxX - b.minX) : 1
  const sy = b.maxY - b.minY > 1e-6 ? (target.maxY - target.minY) / (b.maxY - b.minY) : 1
  return mapStrokes(strokes, (p) => ({
    x: target.minX + (p.x - b.minX) * sx,
    y: target.minY + (p.y - b.minY) * sy,
  }))
}

/**
 * FNV-1a with a finishing mix, for anything that needs to look random and be
 * the same every time.
 *
 * Plain FNV-1a is not enough here. Labels such as "dy:a" and "dy:b" differ
 * only in their last byte, and one multiply spreads that difference across
 * about a tenth of the output range. Every letter got nearly the same
 * "random" offset. The three extra rounds are MurmurHash3's finaliser.
 */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A stable value in [-1, 1) for a label. */
export function noise(label: string): number {
  return (hash(label) / 4294967296) * 2 - 1
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Sum of the absolute turn at every vertex, in degrees. A full loop is about 360. */
export function totalTurning(stroke: Stroke): number {
  let total = 0
  for (let i = 1; i < stroke.length - 1; i++) total += Math.abs(turnAt(stroke, i))
  return total
}

/**
 * The exponent that maps roundness onto a superellipse |x|^n + |y|^n = 1.
 * Roundness 1 is n = 2, a true ellipse. Roundness 0 is n = 5, close to a box.
 */
export const squarenessExponent = (roundness: number): number => 5 - 3 * clamp(roundness, 0, 1)
export const roundnessFromExponent = (n: number): number => clamp((5 - n) / 3, 0, 1)

/** Distance from the centre to a unit superellipse of exponent n, along angle theta. */
export function superellipseRadius(theta: number, n: number): number {
  return (Math.abs(Math.cos(theta)) ** n + Math.abs(Math.sin(theta)) ** n) ** (-1 / n)
}
