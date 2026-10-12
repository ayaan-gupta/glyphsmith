import { describe, expect, it } from 'vitest'
import { measureRoundness, measureSlant, measureStyle, measureTerminal, measureVertical, sampleNormalisation } from '@/core/measure'
import { synthSamples } from '@/core/synth'
import type { GlyphSample, StyleProfile } from '@/core/types'
import { DEFAULT_PROFILE } from '@/core/types'
import { primitiveHand, skeleton } from './helpers'

const base: StyleProfile = { ...DEFAULT_PROFILE }

describe('slant', () => {
  it('ACCEPTANCE: reads a synthetic 12 degree italic to within 2 degrees', () => {
    const measured = measureSlant(primitiveHand({ slant: 12 }))
    expect(Math.abs(measured - 12)).toBeLessThan(2)
  })

  it('holds across upright, backhand and steep hands', () => {
    for (const slant of [-15, -6, 0, 5, 20, 30]) {
      const measured = measureSlant(primitiveHand({ slant }))
      expect(Math.abs(measured - slant), `slant ${slant} read as ${measured.toFixed(2)}`).toBeLessThan(2)
    }
  })

  it('is not dragged toward zero by the bowls', () => {
    // Only letters with a bowl and at most one stem. A windowed mean of
    // segment angles reads this set several degrees short.
    const bowls = primitiveHand({ slant: 18 }).filter((s) => ['a', 'd', 'o', 'e'].includes(s.char))
    expect(Math.abs(measureSlant(bowls) - 18)).toBeLessThan(3)
  })

  it('survives an unsteady hand', () => {
    const noisy = synthSamples(skeleton, { ...base, slant: 12 }, { jitter: 5 })
    expect(Math.abs(measureSlant(noisy) - 12)).toBeLessThan(2.5)
  })

  it('agrees with the deformation code about what a slant is', () => {
    for (const slant of [-10, 8, 22]) {
      expect(Math.abs(measureSlant(synthSamples(skeleton, { ...base, slant })) - slant)).toBeLessThan(2)
    }
  })

  it('returns zero when there is nothing upright to measure', () => {
    expect(measureSlant([])).toBe(0)
    expect(measureSlant([{ char: 'x', strokes: [[{ x: 0, y: 0 }, { x: 500, y: 10 }]] }])).toBe(0)
  })
})

describe('vertical proportions', () => {
  it('recovers the x-height ratio from independent letters', () => {
    for (const [xHeight, ascender] of [[400, 720], [480, 720], [560, 700]] as const) {
      const v = measureVertical(primitiveHand({ xHeight, ascender }))
      expect(v.xHeight / v.ascender).toBeCloseTo(xHeight / ascender, 2)
    }
  })

  it('finds a baseline that is not where the guides were', () => {
    const v = measureVertical(primitiveHand({ baseline: 137 }))
    expect(v.baseline).toBeCloseTo(137, 0)
    expect(sampleNormalisation(primitiveHand({ baseline: 137, ascender: 360, xHeight: 240 })).scale).toBeCloseTo(2, 1)
  })

  it('reports wobble in proportion to how much the letters bounce', () => {
    const steady = measureVertical(primitiveHand())
    expect(steady.wobble).toBeLessThan(0.005)
    const bounce = (amount: number): GlyphSample[] =>
      primitiveHand().map((s, i) => ({ ...s, strokes: s.strokes.map((st) => st.map((p) => ({ x: p.x, y: p.y + (i % 2 ? amount : -amount) }))) }))
    const small = measureVertical(bounce(10)).wobble
    const large = measureVertical(bounce(40)).wobble
    expect(small).toBeGreaterThan(0.01)
    expect(large).toBeGreaterThan(small * 3)
    // Alternating plus and minus 40 on a 480 x-height is a deviation near 40/480.
    // Not exact, because the bouncing letters also shift the measured x-height.
    expect(Math.abs(large - 40 / 480)).toBeLessThan(0.012)
  })
})

describe('roundness', () => {
  const superellipse = (n: number, slant = 0): GlyphSample => ({
    char: 'o',
    strokes: [
      Array.from({ length: 121 }, (_, i) => {
        const t = (i * 3 * Math.PI) / 180
        const x = 250 + 220 * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** (2 / n)
        const y = 240 + 240 * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** (2 / n)
        return { x: x + y * Math.tan((slant * Math.PI) / 180), y }
      }),
    ],
  })

  it('scores an ellipse as round and a boxy loop as square', () => {
    expect(measureRoundness([superellipse(2)])).toBeGreaterThan(0.93)
    expect(measureRoundness([superellipse(3.5)])).toBeCloseTo(0.5, 1)
    expect(measureRoundness([superellipse(5)])).toBeLessThan(0.07)
  })

  it('sees through a slant when told what it is', () => {
    expect(measureRoundness([superellipse(2, 20)], 20)).toBeGreaterThan(0.9)
    expect(measureRoundness([superellipse(5, 20)], 20)).toBeLessThan(0.12)
  })

  it('ignores strokes that are not bowls', () => {
    const stem: GlyphSample = { char: 'l', strokes: [[{ x: 0, y: 0 }, { x: 0, y: 700 }]] }
    expect(measureRoundness([stem])).toBe(DEFAULT_PROFILE.roundness)
  })

  it('reads back the roundness a hand was generated with', () => {
    for (const roundness of [0.1, 0.5, 0.9]) {
      const measured = measureStyle(synthSamples(skeleton, { ...base, roundness, slant: 9 }), { skeleton }).roundness
      expect(Math.abs(measured - roundness), `roundness ${roundness} read as ${measured.toFixed(2)}`).toBeLessThan(0.2)
    }
  })
})

describe('terminals', () => {
  it('calls a stroke tapered when its ends are thinner than its middle', () => {
    const even = Array.from({ length: 20 }, () => 50)
    const tapered = Array.from({ length: 20 }, (_, i) => 50 * Math.min(1, 0.3 + Math.min(i, 19 - i) / 5))
    expect(measureTerminal([even, even])).toBe('round')
    expect(measureTerminal([tapered, tapered])).toBe('tapered')
    expect(measureTerminal([])).toBe('round')
  })
})

describe('measureStyle', () => {
  it('hands back the profile a synthetic hand was written with', () => {
    const truth: StyleProfile = { slant: 14, strokeWidth: 60, xHeightRatio: 0.6, roundness: 0.7, wobble: 0, widthScale: 0.85, terminal: 'round' }
    const measured = measureStyle(synthSamples(skeleton, truth), { penWidth: 60, skeleton })
    expect(Math.abs(measured.slant - truth.slant)).toBeLessThan(2)
    expect(measured.xHeightRatio).toBeCloseTo(truth.xHeightRatio, 1)
    expect(Math.abs(measured.widthScale - truth.widthScale)).toBeLessThan(0.12)
    expect(measured.strokeWidth).toBeCloseTo(60, 0)
  })

  it('tells a narrow hand from a wide one', () => {
    const narrow = measureStyle(synthSamples(skeleton, { ...base, widthScale: 0.7 }), { skeleton }).widthScale
    const wide = measureStyle(synthSamples(skeleton, { ...base, widthScale: 1.35 }), { skeleton }).widthScale
    expect(narrow).toBeLessThan(0.85)
    expect(wide).toBeGreaterThan(1.2)
  })

  it('does not read a steep lean as extra width', () => {
    const upright = measureStyle(synthSamples(skeleton, { ...base, slant: 0 }), { skeleton }).widthScale
    const leaning = measureStyle(synthSamples(skeleton, { ...base, slant: 25 }), { skeleton }).widthScale
    expect(Math.abs(upright - leaning)).toBeLessThan(0.15)
  })

  it('scales the pen with the writing when someone writes small', () => {
    const small = synthSamples(skeleton, base, { scale: 0.5 })
    expect(measureStyle(small, { penWidth: 30, skeleton }).strokeWidth).toBeCloseTo(60, 0)
  })

  it('falls back to defaults with nothing drawn', () => {
    expect(measureStyle([], { penWidth: 70 })).toEqual({ ...DEFAULT_PROFILE, strokeWidth: 70 })
  })
})
