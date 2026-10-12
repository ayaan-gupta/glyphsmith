import { describe, expect, it } from 'vitest'
import { buildGlyph, calibrate } from '@/core/build'
import { resampleBySpacing, simplify } from '@/core/geom'
import { synthSamples } from '@/core/synth'
import { ASCENDER, DEFAULT_PROFILE, DESCENDER, SAMPLE_CHARS } from '@/core/types'
import { clientToFont, fontToClient, GUIDES, VIEW } from '@/ui/view'
import { skeleton } from './helpers'

describe('stroke capture', () => {
  const rect = { left: 40, top: 300, width: 216 }

  it('puts the baseline guide at y = 0 and flips the y axis', () => {
    const baseline = fontToClient(rect, 0, 0)
    const above = fontToClient(rect, 0, 500)
    expect(above.y).toBeLessThan(baseline.y)
    expect(clientToFont(rect, baseline.x, baseline.y)).toEqual({ x: 0, y: 0 })
  })

  it('round-trips a pointer position through font units at any canvas size', () => {
    for (const width of [120, 216, 640]) {
      const r = { left: 13, top: 77, width }
      const p = clientToFont(r, 13 + width * 0.3, 77 + width * 0.4)
      const back = fontToClient(r, p.x, p.y)
      expect(back.x).toBeCloseTo(13 + width * 0.3, 6)
      expect(back.y).toBeCloseTo(77 + width * 0.4, 6)
    }
  })

  it('shows every guide, with room above the ascender and below the descender', () => {
    expect(GUIDES.map((g) => g.y)).toEqual([ASCENDER, 480, 0, DESCENDER])
    expect(VIEW.maxY).toBeGreaterThan(ASCENDER + 100)
    expect(VIEW.minY).toBeLessThan(DESCENDER - 50)
  })

  it('asks for exactly the ten letters the method needs', () => {
    expect(SAMPLE_CHARS.join('')).toBe('aeotnrshld')
  })
})

describe('per-letter redo', () => {
  const samples = synthSamples(skeleton, { ...DEFAULT_PROFILE, slant: 10 })
  const cal = calibrate(samples, skeleton, 56)

  it('falls back to the derived letter when a sample is cleared', () => {
    const drawn = buildGlyph('s', skeleton, cal, samples.find((s) => s.char === 's'))
    const cleared = buildGlyph('s', skeleton, cal, { char: 's', strokes: [] })
    expect(drawn.source).toBe('blend')
    expect(cleared.source).toBe('skeleton')
    expect(cleared.contours.length).toBeGreaterThan(0)
  })

  it('ignores a stray tap when deciding whether a letter was drawn', () => {
    const tap = buildGlyph('o', skeleton, cal, { char: 'o', strokes: [[{ x: 200, y: 200 }]] })
    expect(tap.source).toBe('skeleton')
  })

  it('keeps a noisy pointer path once it is resampled and simplified', () => {
    const raw = Array.from({ length: 400 }, (_, i) => ({ x: i * 1.5 + Math.sin(i) * 0.8, y: 300 + Math.cos(i * 1.7) * 0.8 }))
    const tidy = simplify(resampleBySpacing(raw, 14), 2)
    expect(tidy.length).toBeLessThan(8)
    expect(tidy[0]!.x).toBeCloseTo(raw[0]!.x, 3)
    expect(tidy[tidy.length - 1]!.x).toBeCloseTo(raw[raw.length - 1]!.x, 3)
  })
})
