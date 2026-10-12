import { bbox, clamp, dist, median, relax, resampleBySpacing, roundnessFromExponent, totalTurning, turnAt } from './geom'
import type { SkeletonGlyph } from './hershey'
import type { GlyphSample, Stroke, StyleProfile, Terminal } from './types'
import { ASCENDER, DEFAULT_PROFILE, X_HEIGHT } from './types'

const X_HEIGHT_LETTERS = new Set(['a', 'e', 'o', 'n', 'r', 's'])
const ASCENDER_LETTERS = new Set(['h', 'l', 'd'])
const WIDTH_LETTERS = new Set(['a', 'e', 'o', 'n', 's', 'h', 'd'])

/**
 * Slant, as the most common direction among strokes that run roughly upright.
 *
 * A mean would be simpler and wrong. The sides of an "o" contribute segments
 * at every angle, so a mean over a fixed window gets dragged toward zero as
 * the writing leans. The mode does not care: stems are straight, so they pile
 * up in one narrow band of angles, and that peak is the slant.
 */
export function measureSlant(samples: GlyphSample[]): number {
  const BINS = 121 // -60 to +60 degrees, one bin per degree
  const weight = new Float64Array(BINS)
  for (const sample of samples)
    for (const raw of sample.strokes) {
      // Two smoothing passes and a coarse step, so pointer jitter does not
      // masquerade as direction. Each segment spans 20 units of real travel.
      const stroke = resampleBySpacing(relax(resampleBySpacing(raw, 10), 0.5, 2), 20)
      for (let i = 1; i < stroke.length; i++) {
        const dx = stroke[i]!.x - stroke[i - 1]!.x
        const dy = stroke[i]!.y - stroke[i - 1]!.y
        const len = Math.hypot(dx, dy)
        if (len === 0) continue
        // Angle from vertical, direction-blind: an upstroke and a downstroke agree.
        let angle = (Math.atan2(dx, dy) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle < -90) angle += 180
        if (Math.abs(angle) > 60) continue
        // Straight runs are stems, and stems are the signal. Bends count less.
        const bend = Math.abs(turnAt(stroke, i - 1)) + Math.abs(turnAt(stroke, i))
        weight[Math.round(angle) + 60]! += len / (1 + bend / 4)
      }
    }

  let peak = 60
  let best = 0
  for (let b = 0; b < BINS; b++) {
    // Gaussian smoothing, sigma 3 degrees, so one noisy bin cannot win.
    let v = 0
    for (let k = -9; k <= 9; k++) {
      const j = b + k
      if (j >= 0 && j < BINS) v += weight[j]! * Math.exp(-(k * k) / 18)
    }
    if (v > best) {
      best = v
      peak = b
    }
  }
  if (best === 0) return 0

  // Refine to sub-degree with a weighted mean in a narrow band around the peak.
  let sum = 0
  let total = 0
  for (let j = Math.max(0, peak - 6); j <= Math.min(BINS - 1, peak + 6); j++) {
    sum += (j - 60) * weight[j]!
    total += weight[j]!
  }
  return total > 0 ? sum / total : peak - 60
}

/**
 * Roundness, read off the bowls.
 *
 * A closed loop such as an "o" is fitted with a superellipse, the family of
 * curves |x|^n + |y|^n = 1 that runs from a diamond (n = 1) through an ellipse
 * (n = 2) to a box (large n). The best exponent says how square the hand
 * draws its rounds. Only points near the diagonals vote, because along the
 * axes every exponent gives the same curve.
 *
 * An earlier version measured how evenly a stroke's turning was spread along
 * its length. It could not tell these hands apart at all: the score moved
 * from 0.967 to 0.977 across the whole range.
 */
export function measureRoundness(samples: GlyphSample[], slant = 0, baseline = 0): number {
  const shear = Math.tan((slant * Math.PI) / 180)
  const votes: number[] = []
  for (const sample of samples)
    for (const raw of sample.strokes) {
      if (raw.length < 8) continue
      // Stand the stroke upright first. A slanted ellipse is not a superellipse.
      const stroke = resampleBySpacing(raw.map((p) => ({ x: p.x - (p.y - baseline) * shear, y: p.y })), 12)
      const box = bbox([stroke])
      if (!box) continue
      const a = (box.maxX - box.minX) / 2
      const b = (box.maxY - box.minY) / 2
      if (a < 20 || b < 20) continue
      const gap = dist(stroke[0]!, stroke[stroke.length - 1]!)
      // A bowl: it goes most of the way round and ends near where it began.
      if (totalTurning(stroke) < 270 || gap > 0.45 * Math.hypot(2 * a, 2 * b)) continue
      const cx = (box.minX + box.maxX) / 2
      const cy = (box.minY + box.maxY) / 2
      const diagonal = stroke
        .map((p) => ({ u: Math.abs(p.x - cx) / a, v: Math.abs(p.y - cy) / b }))
        .filter((q) => q.u > 0.3 && q.v > 0.3)
      if (diagonal.length < 6) continue
      let bestN = 2
      let bestError = Infinity
      for (let n = 1; n <= 8; n += 0.05) {
        let error = 0
        for (const q of diagonal) error += (q.u ** n + q.v ** n - 1) ** 2
        if (error < bestError) {
          bestError = error
          bestN = n
        }
      }
      votes.push(bestN)
    }
  return votes.length ? roundnessFromExponent(median(votes)) : DEFAULT_PROFILE.roundness
}

interface Vertical {
  baseline: number
  xHeight: number
  ascender: number
  wobble: number
}

/** Where the letters sit and how tall they stand, from their bounding boxes. */
export function measureVertical(samples: GlyphSample[]): Vertical {
  const bottoms: number[] = []
  const xTops: number[] = []
  const ascTops: number[] = []
  for (const s of samples) {
    const b = bbox(s.strokes)
    if (!b) continue
    bottoms.push(b.minY)
    if (X_HEIGHT_LETTERS.has(s.char)) xTops.push(b.maxY)
    if (ASCENDER_LETTERS.has(s.char)) ascTops.push(b.maxY)
  }
  const baseline = median(bottoms)
  const xHeight = xTops.length ? median(xTops) - baseline : X_HEIGHT
  const ascender = ascTops.length ? median(ascTops) - baseline : (xHeight * ASCENDER) / X_HEIGHT

  let wobble = 0
  if (bottoms.length > 1 && xHeight > 0) {
    const mean = bottoms.reduce((a, b) => a + b, 0) / bottoms.length
    const variance = bottoms.reduce((a, b) => a + (b - mean) ** 2, 0) / bottoms.length
    wobble = Math.sqrt(variance) / xHeight
  }
  return { baseline, xHeight, ascender, wobble }
}

/**
 * Decides how strokes end. Only meaningful when widths were recorded, which
 * they are for pressure pens and for strokes recovered from a photograph.
 */
export function measureTerminal(widthProfiles: number[][]): Terminal {
  const ratios: number[] = []
  for (const widths of widthProfiles) {
    if (widths.length < 8) continue
    const middle = median(widths.slice(Math.floor(widths.length * 0.3), Math.ceil(widths.length * 0.7)))
    if (middle <= 0) continue
    ratios.push(widths[0]! / middle, widths[widths.length - 1]! / middle)
  }
  if (ratios.length === 0) return 'round'
  return median(ratios) < 0.62 ? 'tapered' : 'round'
}

export interface MeasureOptions {
  /** Pen width used for the samples, when the input device does not vary it. */
  penWidth?: number
  /** Per-stroke widths along the path, when the device recorded them. */
  widthProfiles?: number[][]
  /** The skeleton glyphs, used to judge how wide the hand runs. */
  skeleton?: Map<string, SkeletonGlyph>
}

/** Turns a set of drawn letters into the numbers that describe the hand. */
export function measureStyle(samples: GlyphSample[], options: MeasureOptions = {}): StyleProfile {
  const drawn = samples.filter((s) => s.strokes.some((st) => st.length > 1))
  if (drawn.length === 0) return { ...DEFAULT_PROFILE, strokeWidth: options.penWidth ?? DEFAULT_PROFILE.strokeWidth }

  const vertical = measureVertical(drawn)
  // Everything is reported as if the hand were scaled to a 720 unit ascender.
  const scale = vertical.ascender > 0 ? ASCENDER / vertical.ascender : 1

  let strokeWidth = options.penWidth ?? DEFAULT_PROFILE.strokeWidth
  if (options.widthProfiles?.length) {
    const all = options.widthProfiles.flat()
    if (all.length) strokeWidth = median(all)
  }

  const slant = measureSlant(drawn)

  let widthScale = 1
  if (options.skeleton) {
    // Stand the letters back upright before judging their width. Subtracting
    // an estimate of the lean from the bounding box is not good enough: a
    // sheared ellipse is narrower than its width plus its overhang, and the
    // shortcut read a 25 degree italic as a quarter wider than it was.
    const shear = Math.tan((slant * Math.PI) / 180)
    const ratios: number[] = []
    for (const s of drawn) {
      if (!WIDTH_LETTERS.has(s.char)) continue
      const upright = s.strokes.map((st) => st.map((pt) => ({ x: pt.x - (pt.y - vertical.baseline) * shear, y: pt.y })))
      const mine = bbox(upright)
      const theirs = bbox(options.skeleton.get(s.char)?.strokes ?? [])
      if (!mine || !theirs) continue
      const theirWidth = theirs.maxX - theirs.minX
      const heightRatio = ((mine.maxY - mine.minY) * scale) / Math.max(1, theirs.maxY - theirs.minY)
      if (theirWidth > 1 && heightRatio > 0.2) ratios.push(((mine.maxX - mine.minX) * scale) / theirWidth / heightRatio)
    }
    if (ratios.length) widthScale = clamp(median(ratios), 0.55, 1.6)
  }

  return {
    slant: clamp(slant, -40, 40),
    strokeWidth: clamp(strokeWidth * scale, 12, 160),
    xHeightRatio: clamp(vertical.xHeight / Math.max(1, vertical.ascender), 0.4, 0.9),
    roundness: measureRoundness(drawn, slant, vertical.baseline),
    wobble: clamp(vertical.wobble, 0, 0.25),
    widthScale,
    terminal: measureTerminal(options.widthProfiles ?? []),
  }
}

/** The factor and offset that bring raw samples onto the font's own metrics. */
export function sampleNormalisation(samples: GlyphSample[]): { scale: number; baseline: number } {
  const drawn = samples.filter((s) => s.strokes.some((st) => st.length > 1))
  if (drawn.length === 0) return { scale: 1, baseline: 0 }
  const v = measureVertical(drawn)
  return { scale: v.ascender > 0 ? ASCENDER / v.ascender : 1, baseline: v.baseline }
}

export function strokeDistance(a: Stroke, b: Stroke): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return Infinity
  let sum = 0
  for (let i = 0; i < n; i++) sum += dist(a[i]!, b[i]!)
  return sum / n
}
