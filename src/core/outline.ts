import ClipperLib from 'clipper-lib'
import type { IntPoint, Path, Paths } from 'clipper-lib'
import { pathLength, resampleBySpacing, simplify } from './geom'
import type { Stroke, Terminal } from './types'

export interface OutlinePoint {
  x: number
  y: number
  /** TrueType's on-curve flag. Off-curve points are quadratic control points. */
  on: boolean
}

export type Contour = OutlinePoint[]

// Clipper works in integers. Sixteenths of a font unit is plenty.
const SCALE = 16
const DISC_SIDES = 20

function disc(cx: number, cy: number, r: number): Path {
  const path: Path = []
  for (let i = 0; i < DISC_SIDES; i++) {
    const a = (i / DISC_SIDES) * Math.PI * 2
    path.push({ X: Math.round((cx + Math.cos(a) * r) * SCALE), Y: Math.round((cy + Math.sin(a) * r) * SCALE) })
  }
  return path
}

/** Pen width along a stroke. Tapered pens thin out over the first and last stretch. */
export function widthsAlong(stroke: Stroke, width: number, terminal: Terminal): number[] {
  if (terminal !== 'tapered' || stroke.length < 3) return stroke.map(() => width)
  const total = pathLength(stroke)
  const ramp = Math.min(total * 0.3, Math.max(60, total * 0.18))
  let travelled = 0
  return stroke.map((p, i) => {
    if (i > 0) travelled += Math.hypot(p.x - stroke[i - 1]!.x, p.y - stroke[i - 1]!.y)
    const fromEnd = Math.min(travelled, total - travelled)
    const t = ramp > 0 ? Math.min(1, fromEnd / ramp) : 1
    return width * (0.38 + 0.62 * t)
  })
}

/**
 * Turns pen paths into filled shapes.
 *
 * Each stroke becomes a chain of discs joined by quadrilaterals, and Clipper
 * unions the lot. That is slower than offsetting the path directly and much
 * harder to get wrong: self-crossing strokes, strokes that touch each other
 * and pens that change width are all the same case.
 */
export function strokesToPolygons(strokes: Stroke[], width: number, terminal: Terminal): Paths {
  const clipper = new ClipperLib.Clipper()
  const add = (path: Path) => {
    // Clipper's union wants consistently wound input under the non-zero rule.
    if (!ClipperLib.Clipper.Orientation(path)) path.reverse()
    clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true)
  }

  for (const raw of strokes) {
    if (raw.length === 0) continue
    // A tapered pen needs points along the whole stroke to carry its width.
    // Simplifying first would collapse a straight stem to its two ends, both
    // of which are thin, and the stem would lose its body.
    const stroke = terminal === 'tapered' ? resampleBySpacing(raw, 18) : raw.length > 2 ? simplify(raw, 0.7) : raw
    const widths = widthsAlong(stroke, width, terminal)
    const last = stroke.length - 1

    stroke.forEach((p, i) => {
      const isEnd = i === 0 || i === last
      // A flat terminal is simply a missing end cap. A lone dot keeps its disc.
      if (isEnd && terminal === 'flat' && stroke.length > 1) return
      add(disc(p.x, p.y, widths[i]! / 2))
    })

    for (let i = 0; i < last; i++) {
      const a = stroke[i]!
      const b = stroke[i + 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-6) continue
      const nx = -dy / len
      const ny = dx / len
      const ra = widths[i]! / 2
      const rb = widths[i + 1]! / 2
      const pt = (x: number, y: number): IntPoint => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })
      add([
        pt(a.x + nx * ra, a.y + ny * ra),
        pt(a.x - nx * ra, a.y - ny * ra),
        pt(b.x - nx * rb, b.y - ny * rb),
        pt(b.x + nx * rb, b.y + ny * rb),
      ])
    }
  }

  const solution: Paths = new ClipperLib.Paths()
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  return solution
}

/** Simplifies a closed ring without letting the seam be the one point that survives by accident. */
function simplifyRing(ring: Array<{ x: number; y: number }>, epsilon: number): Array<{ x: number; y: number }> {
  if (ring.length < 5) return ring
  // Start the walk at the point furthest from the centroid, which is certain
  // to be kept, so the cut does not land in the middle of a curve.
  let cx = 0, cy = 0
  for (const p of ring) { cx += p.x; cy += p.y }
  cx /= ring.length; cy /= ring.length
  let start = 0
  let far = -1
  ring.forEach((p, i) => {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2
    if (d > far) { far = d; start = i }
  })
  const rotated = [...ring.slice(start), ...ring.slice(0, start)]
  const half = rotated.length >> 1
  const first = simplify(rotated.slice(0, half + 1), epsilon)
  const second = simplify([...rotated.slice(half), rotated[0]!], epsilon)
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

const CORNER_DEGREES = 28
const LONG_EDGE = 60

/**
 * Converts a polygon to TrueType points, choosing which vertices are control
 * points.
 *
 * TrueType lets a contour list several off-curve points in a row, with an
 * on-curve point implied halfway between each pair. So a run of gently
 * turning vertices can be written as control points alone and the rasteriser
 * draws a smooth quadratic spline through the midpoints of the polygon's
 * edges. Sharp vertices and the ends of long straight edges stay on-curve.
 */
export function polygonToContour(ring: Array<{ x: number; y: number }>): Contour {
  const pts: Array<{ x: number; y: number }> = []
  for (const p of ring) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) }
    const prev = pts[pts.length - 1]
    if (!prev || prev.x !== q.x || prev.y !== q.y) pts.push(q)
  }
  if (pts.length > 1 && pts[0]!.x === pts[pts.length - 1]!.x && pts[0]!.y === pts[pts.length - 1]!.y) pts.pop()
  const n = pts.length
  if (n < 3) return []

  const contour: Contour = pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n]!
    const c = pts[(i + 1) % n]!
    const ux = p.x - a.x, uy = p.y - a.y
    const vx = c.x - p.x, vy = c.y - p.y
    const turn = Math.abs((Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI)
    const longEdge = Math.hypot(ux, uy) > LONG_EDGE || Math.hypot(vx, vy) > LONG_EDGE
    return { x: p.x, y: p.y, on: turn > CORNER_DEGREES || longEdge }
  })

  // A contour made only of control points is legal, but several parsers want
  // one real point to start from. Add the implied one explicitly: it sits
  // exactly on the curve, so the shape does not change.
  if (!contour.some((p) => p.on)) {
    const a = contour[n - 1]!
    const b = contour[0]!
    contour.unshift({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), on: true })
  }
  return contour
}

/** Pen strokes in, TrueType contours out. Outer contours run clockwise, holes counter-clockwise. */
export function outlineStrokes(strokes: Stroke[], width: number, terminal: Terminal): Contour[] {
  const polygons = strokesToPolygons(strokes, width, terminal)
  const contours: Contour[] = []
  for (const polygon of polygons) {
    if (Math.abs(ClipperLib.Clipper.Area(polygon)) < 4 * SCALE * SCALE) continue
    // Clipper hands back outers counter-clockwise in a y-up frame. TrueType
    // wants the opposite, so every ring is reversed.
    const ring = polygon.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })).reverse()
    const contour = polygonToContour(simplifyRing(ring, 0.6))
    if (contour.length >= 3) contours.push(contour)
  }
  // Stable order, so the same strokes always serialise to the same bytes.
  contours.sort((a, b) => a[0]!.x - b[0]!.x || a[0]!.y - b[0]!.y || a.length - b.length)
  return contours
}
