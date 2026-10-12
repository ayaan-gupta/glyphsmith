import { shapeSkeleton } from './deform'
import { noise } from './geom'
import type { SkeletonGlyph } from './hershey'
import type { GlyphSample, StyleProfile } from './types'
import { SAMPLE_CHARS } from './types'

export interface SynthOptions {
  /** How much smaller or larger than the guides the person writes. */
  scale?: number
  /** How far above or below the printed baseline they sit. */
  baseline?: number
  /** Point noise in font units, like a slightly unsteady hand. */
  jitter?: number
}

/**
 * Writes the ten sample letters in an invented hand.
 *
 * Used by the "demo hand" buttons in the app, the recorded demo, and the
 * tests. It bends the skeleton by a known profile, which means measuring the
 * result should hand that profile back. Tests that must not be circular (the
 * slant acceptance test among them) draw their letters from primitives.
 */
export function synthSamples(skeleton: Map<string, SkeletonGlyph>, profile: StyleProfile, options: SynthOptions = {}): GlyphSample[] {
  const { scale = 1, baseline = 0, jitter = 0 } = options
  return SAMPLE_CHARS.map((char) => {
    const shaped = shapeSkeleton(skeleton.get(char)!, profile)
    return {
      char,
      strokes: shaped.strokes.map((stroke, si) =>
        stroke.map((p, i) => ({
          x: p.x * scale + noise(`jx:${char}:${si}:${i}`) * jitter,
          y: p.y * scale + baseline + noise(`jy:${char}:${si}:${i}`) * jitter,
        })),
      ),
    }
  })
}

/** Three invented hands for people who want to see it work before drawing anything. */
export const DEMO_HANDS: Array<{ name: string; blurb: string; profile: StyleProfile }> = [
  {
    name: 'Hurried',
    blurb: 'Leaning hard, thin pen, in a rush.',
    profile: { slant: 16, strokeWidth: 44, xHeightRatio: 0.6, roundness: 0.75, wobble: 0.05, widthScale: 0.86, terminal: 'tapered' },
  },
  {
    name: 'Round',
    blurb: 'Upright, fat marker, big bowls.',
    profile: { slant: -2, strokeWidth: 84, xHeightRatio: 0.74, roundness: 0.95, wobble: 0.02, widthScale: 1.12, terminal: 'round' },
  },
  {
    name: 'Drafting',
    blurb: 'Architect lettering: square and even.',
    profile: { slant: 4, strokeWidth: 52, xHeightRatio: 0.66, roundness: 0.12, wobble: 0.008, widthScale: 1.0, terminal: 'flat' },
  },
]
