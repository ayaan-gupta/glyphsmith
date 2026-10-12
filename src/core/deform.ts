import { bbox, fitToBox, mapStrokes, noise, relax, resampleByCount, resampleBySpacing, smoothThrough, squarenessExponent, superellipseRadius, totalTurning } from './geom'
import type { SkeletonGlyph } from './hershey'
import { strokeDistance } from './measure'
import type { GlyphSample, Stroke, StyleProfile } from './types'
import { ASCENDER, isLower, X_HEIGHT } from './types'

export interface ShapedGlyph {
  char: string
  strokes: Stroke[]
  advance: number
  /** Side bearings measured with the letter standing upright, before any slant. */
  lsb: number
  rsb: number
  /** Where the strokes came from, for the UI and for tests. */
  source: 'skeleton' | 'blend' | 'sample'
}

/** Samples are measured once and then frozen, so one redraw cannot move 89 other glyphs. */
export interface Calibration {
  profile: StyleProfile
  /** Multiplier that brings the drawn letters to a 720 unit ascender. */
  scale: number
  /** Where the drawn letters sat, in the units they were drawn in. */
  baseline: number
}

const SPACING = 14
/** Share of the skeleton's side bearings that survives. */
const TRACKING = 0.55
/** A stroke that turns through less than this is a line with a bend, and is left alone. */
const CURVED_ENOUGH = 150

/**
 * Pushes a curved stroke outward toward the corners of its own bounding box,
 * the way a circle becomes a rounded square as a superellipse's exponent
 * grows. Points keep their direction from the centre and only their distance
 * changes, so the box itself, and with it the letter's size, stays put.
 */
function squareOff(stroke: Stroke, exponent: number): Stroke {
  const box = bbox([stroke])
  if (!box) return stroke
  const a = (box.maxX - box.minX) / 2
  const b = (box.maxY - box.minY) / 2
  if (a < 1 || b < 1) return stroke
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return stroke.map((pt) => {
    const u = (pt.x - cx) / a
    const v = (pt.y - cy) / b
    const k = superellipseRadius(Math.atan2(v, u), exponent)
    return { x: cx + u * k * a, y: cy + v * k * b }
  })
}
/** Hershey's bowls are polygons. Anything gentler than this is meant as a curve. */
const SKELETON_CORNER = 50

/**
 * Bends one skeleton glyph toward a measured hand.
 *
 * Order matters. Rounding happens first, on the upright shape, because
 * "round" is a property of the letterform and not of the lean. Slant goes
 * last so that every earlier step can reason in an upright frame.
 */
export function shapeSkeleton(glyph: SkeletonGlyph, p: StyleProfile): ShapedGlyph {
  if (glyph.strokes.length === 0) {
    return { char: glyph.char, strokes: [], advance: glyph.advance * p.widthScale, lsb: 0, rsb: 0, source: 'skeleton' }
  }

  // 1. Smooth the polygonal bowls, then apply roundness in its two senses.
  //    Bowls and arches are pushed from ellipse toward box as roundness
  //    falls, and corners are softened as it rises.
  let strokes = glyph.strokes.map((s) => smoothThrough(s, SKELETON_CORNER, SPACING))
  const exponent = squarenessExponent(p.roundness)
  if (exponent > 2.05) strokes = strokes.map((s) => (totalTurning(s) >= CURVED_ENOUGH ? squareOff(s, exponent) : s))
  const before = bbox(strokes)!
  const passes = Math.round(p.roundness * 6)
  if (passes > 0) {
    strokes = strokes.map((s) => relax(s, 0.5, passes))
    // Relaxing shrinks a shape toward its middle. Put it back in its box.
    strokes = fitToBox(strokes, before)
  }

  // 2. Move the x-height. Lowercase only: a capital has no x-height to move.
  if (isLower(glyph.char)) {
    const xh = p.xHeightRatio * ASCENDER
    strokes = mapStrokes(strokes, (pt) => {
      if (pt.y <= 0) return pt
      if (pt.y <= X_HEIGHT) return { x: pt.x, y: (pt.y * xh) / X_HEIGHT }
      return { x: pt.x, y: xh + ((pt.y - X_HEIGHT) * (ASCENDER - xh)) / (ASCENDER - X_HEIGHT) }
    })
  }

  // 3. Width and spacing. Hershey's side bearings were tuned for a plotter
  //    drawing hairlines with air between them, which reads as loose for
  //    handwriting, so they are tightened and then padded by the pen.
  strokes = mapStrokes(strokes, (pt) => ({ x: pt.x * p.widthScale, y: pt.y }))
  const wide = bbox(strokes)!
  const pen = p.strokeWidth * 0.5
  const lsb = Math.max(0, wide.minX) * TRACKING + pen
  const rsb = Math.max(0, glyph.advance * p.widthScale - wide.maxX) * TRACKING + pen
  strokes = mapStrokes(strokes, (pt) => ({ x: pt.x - wide.minX + lsb, y: pt.y }))
  const advance = lsb + (wide.maxX - wide.minX) + rsb

  // 4. Wobble: each letter sits a little high or low and tips a little, the
  //    same way every time for a given letter.
  if (p.wobble > 0) {
    const xh = p.xHeightRatio * ASCENDER
    // Uniform noise on [-1, 1) has a standard deviation of 1/sqrt(3), so this
    // factor makes the spread of the offsets equal to `wobble` exactly.
    const dy = noise(`dy:${glyph.char}`) * p.wobble * xh * Math.sqrt(3)
    const angle = noise(`rot:${glyph.char}`) * p.wobble * 0.9
    const box = bbox(strokes)!
    const cx = (box.minX + box.maxX) / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const phase = noise(`ph:${glyph.char}`) * Math.PI
    strokes = strokes.map((s, si) =>
      s.map((pt, i) => {
        const tremor = Math.sin(i * 0.35 + phase + si) * p.wobble * xh * 0.12
        const x = pt.x - cx
        return { x: cx + x * cos - pt.y * sin + tremor, y: x * sin + pt.y * cos + dy }
      }),
    )
  }

  // 5. Slant.
  const shear = Math.tan((p.slant * Math.PI) / 180)
  if (shear !== 0) strokes = mapStrokes(strokes, (pt) => ({ x: pt.x + pt.y * shear, y: pt.y }))

  return { char: glyph.char, strokes, advance, lsb, rsb, source: 'skeleton' }
}

/**
 * Brings a drawn letter onto the font's vertical metrics and takes the jitter
 * out of it. Horizontal placement is left to `blendWithSample`, which knows
 * what bearings the matching skeleton letter has.
 */
export function prepareSample(sample: GlyphSample, cal: Calibration): Stroke[] {
  return sample.strokes
    .filter((s) => s.length > 0)
    .map((s) => s.map((pt) => ({ x: pt.x * cal.scale, y: (pt.y - cal.baseline) * cal.scale })))
    .map((s) => (s.length > 2 ? relax(resampleBySpacing(s, SPACING), 0.5, 2) : s))
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0]]
  const out: number[][] = []
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) out.push(prefix)
    rest.forEach((v, i) => walk([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]))
  }
  walk([], Array.from({ length: n }, (_, i) => i))
  return out
}

const COMPARE_POINTS = 32

/**
 * Finds which drawn stroke corresponds to which skeleton stroke, trying every
 * order and both directions. People do not all start an "h" at the top.
 * Returns null when the letter was built differently enough that pairing the
 * strokes would be meaningless.
 */
export function matchStrokes(skeleton: Stroke[], drawn: Stroke[]): { order: number[]; reversed: boolean[]; cost: number } | null {
  if (skeleton.length !== drawn.length || skeleton.length === 0 || skeleton.length > 4) return null
  const a = bbox(skeleton)!
  const b = bbox(drawn)!
  const dx = (a.minX + a.maxX) / 2 - (b.minX + b.maxX) / 2
  const dy = (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2
  const sk = skeleton.map((s) => resampleByCount(s, COMPARE_POINTS))
  const dr = drawn.map((s) => resampleByCount(s.map((p) => ({ x: p.x + dx, y: p.y + dy })), COMPARE_POINTS))
  const drReversed = dr.map((s) => [...s].reverse())

  let best: { order: number[]; reversed: boolean[]; cost: number } | null = null
  for (const order of permutations(skeleton.length)) {
    let cost = 0
    const reversed: boolean[] = []
    order.forEach((j, i) => {
      const forward = strokeDistance(sk[i]!, dr[j]!)
      const backward = strokeDistance(sk[i]!, drReversed[j]!)
      reversed.push(backward < forward)
      cost += Math.min(forward, backward)
    })
    cost /= skeleton.length
    if (!best || cost < best.cost) best = { order, reversed, cost }
  }
  return best
}

/** Above this average distance per point, two strokes are not the same stroke. */
export const MATCH_LIMIT = X_HEIGHT * 0.28

/**
 * Step five of the method: where a real sample exists, blend it in at 70
 * percent so the person's own letter dominates and the skeleton only steadies
 * it. When the strokes cannot be paired, the drawn letter is used untouched.
 * Averaging an "a" drawn in one stroke with an "a" built from two would give
 * a letter nobody wrote.
 */
export function blendWithSample(shaped: ShapedGlyph, raw: Stroke[], slant: number, weight = 0.7): ShapedGlyph {
  // Give the drawn letter the same side bearings its skeleton twin has, so
  // drawn and derived letters space alike. Bearings are judged upright:
  // measured on a leaning letter they would grow with the lean.
  const shear = Math.tan((slant * Math.PI) / 180)
  const upright = bbox(raw.map((s) => s.map((p) => ({ x: p.x - p.y * shear, y: p.y }))))
  if (!upright) return shaped
  const shift = shaped.lsb - upright.minX
  const drawn = mapStrokes(raw, (p) => ({ x: p.x + shift, y: p.y }))
  const drawnAdvance = shaped.lsb + (upright.maxX - upright.minX) + shaped.rsb

  const match = matchStrokes(shaped.strokes, drawn)
  if (!match || match.cost > MATCH_LIMIT) {
    return { ...shaped, strokes: drawn, advance: drawnAdvance, source: 'sample' }
  }

  // Line the skeleton up under the drawing before averaging, so the blend
  // mixes shapes and does not smear two positions together.
  const dBox = bbox(drawn)!
  const sBox = bbox(shaped.strokes)!
  const dx = (dBox.minX + dBox.maxX) / 2 - (sBox.minX + sBox.maxX) / 2
  const strokes = shaped.strokes.map((skeletonStroke, i) => {
    const j = match.order[i]!
    const mine = match.reversed[i] ? [...drawn[j]!].reverse() : drawn[j]!
    const count = Math.max(skeletonStroke.length, mine.length, 2)
    const a = resampleByCount(mine, count)
    const b = resampleByCount(skeletonStroke, count)
    return a.map((p, k) => ({
      x: p.x * weight + (b[k]!.x + dx) * (1 - weight),
      y: p.y * weight + b[k]!.y * (1 - weight),
    }))
  })
  return {
    ...shaped,
    strokes,
    advance: drawnAdvance * weight + shaped.advance * (1 - weight),
    source: 'blend',
  }
}
