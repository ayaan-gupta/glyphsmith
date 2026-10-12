import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import * as opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { buildFont, buildGlyphs, calibrate, toFontGlyphs } from '@/core/build'
import { blendWithSample, matchStrokes, prepareSample, shapeSkeleton } from '@/core/deform'
import { outlineStrokes, polygonToContour } from '@/core/outline'
import { DEMO_HANDS, synthSamples } from '@/core/synth'
import type { GlyphSample, Stroke } from '@/core/types'
import { CHARSET, DEFAULT_PROFILE } from '@/core/types'
import { checksum } from '@/font/binary'
import { encodeGlyph } from '@/font/sfnt'
import { brotliStored, buildWoff2 } from '@/font/woff2'
import { skeleton } from './helpers'

const hand = DEMO_HANDS[0]!
const samples = synthSamples(skeleton, hand.profile, { scale: 0.9, baseline: 12, jitter: 2 })
const cal = calibrate(samples, skeleton, hand.profile.strokeWidth * 0.9)

const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer

function signedArea(points: Array<{ x: number; y: number }>): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

describe('outlining', () => {
  it('turns a straight stroke into one contour of about the right area', () => {
    const contours = outlineStrokes([[{ x: 100, y: 0 }, { x: 100, y: 500 }]], 60, 'round')
    expect(contours).toHaveLength(1)
    const expected = 60 * 500 + Math.PI * 30 * 30
    expect(Math.abs(Math.abs(signedArea(contours[0]!)) - expected) / expected).toBeLessThan(0.04)
  })

  it('cuts flat terminals square', () => {
    const round = outlineStrokes([[{ x: 100, y: 0 }, { x: 100, y: 500 }]], 60, 'round')
    const flat = outlineStrokes([[{ x: 100, y: 0 }, { x: 100, y: 500 }]], 60, 'flat')
    const height = (c: typeof round) => Math.max(...c[0]!.map((p) => p.y)) - Math.min(...c[0]!.map((p) => p.y))
    expect(height(flat)).toBe(500)
    expect(height(round)).toBe(560)
  })

  it('thins a tapered stroke toward its ends and keeps its body', () => {
    const stroke: Stroke = [{ x: 100, y: 0 }, { x: 100, y: 600 }]
    const c = outlineStrokes([stroke], 60, 'tapered')[0]!
    const widthNear = (y: number) => {
      const xs = c.filter((p) => Math.abs(p.y - y) < 40).map((p) => p.x)
      return Math.max(...xs) - Math.min(...xs)
    }
    // Regression: a two-point stem used to come out thin along its whole length.
    expect(widthNear(300)).toBeGreaterThan(54)
    expect(widthNear(300)).toBeGreaterThan(widthNear(0) * 1.5)
  })

  it('gives a closed loop an outer contour and a hole, wound opposite ways', () => {
    const loop: Stroke = Array.from({ length: 49 }, (_, i) => ({ x: 300 + 200 * Math.cos((i * 7.5 * Math.PI) / 180), y: 240 + 240 * Math.sin((i * 7.5 * Math.PI) / 180) }))
    const contours = outlineStrokes([loop], 50, 'round')
    expect(contours).toHaveLength(2)
    const areas = contours.map(signedArea).sort((a, b) => a - b)
    // TrueType convention: the outer contour is clockwise, so its area is negative.
    expect(areas[0]!).toBeLessThan(0)
    expect(areas[1]!).toBeGreaterThan(0)
    expect(Math.abs(areas[0]!)).toBeGreaterThan(Math.abs(areas[1]!))
  })

  it('merges two crossing strokes into a single shape', () => {
    const cross = outlineStrokes([[{ x: 0, y: 200 }, { x: 400, y: 200 }], [{ x: 200, y: 0 }, { x: 200, y: 400 }]], 50, 'round')
    expect(cross).toHaveLength(1)
  })

  it('writes curves as control points and keeps real corners on the curve', () => {
    const circle = Array.from({ length: 24 }, (_, i) => ({ x: 100 * Math.cos((i * 15 * Math.PI) / 180), y: 100 * Math.sin((i * 15 * Math.PI) / 180) }))
    const round = polygonToContour(circle)
    expect(round.filter((p) => !p.on).length).toBeGreaterThan(20)
    expect(round.some((p) => p.on)).toBe(true)
    const square = polygonToContour([{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 0 }])
    expect(square.every((p) => p.on)).toBe(true)
  })

  it('emits integer coordinates only', () => {
    for (const g of buildGlyphs(samples, skeleton, cal).slice(0, 20))
      for (const c of g.contours) for (const p of c) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true)
  })
})

describe('blending drawn letters', () => {
  const shaped = shapeSkeleton(skeleton.get('h')!, { ...DEFAULT_PROFILE })

  it('pairs strokes whatever order and direction they were drawn in', () => {
    const drawn = [...shaped.strokes].reverse().map((s) => [...s].reverse())
    const match = matchStrokes(shaped.strokes, drawn)!
    expect(match.order).toEqual([1, 0])
    expect(match.reversed).toEqual([true, true])
    expect(match.cost).toBeLessThan(1)
  })

  it('lands 70 percent of the way toward the drawn letter', () => {
    const drawn = shaped.strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y * 1.2 })))
    const blended = blendWithSample(shaped, drawn, 0)
    expect(blended.source).toBe('blend')
    const top = (strokes: Stroke[]) => Math.max(...strokes.flat().map((p) => p.y))
    const expected = top(drawn) * 0.7 + top(shaped.strokes) * 0.3
    expect(Math.abs(top(blended.strokes) - expected)).toBeLessThan(3)
  })

  it('uses the drawn letter as is when it was built differently', () => {
    // An "h" drawn as a single continuous stroke cannot be paired with two.
    const oneStroke = [shaped.strokes.flat()]
    const blended = blendWithSample(shaped, oneStroke, 0)
    expect(blended.source).toBe('sample')
    expect(blended.strokes).toHaveLength(1)
  })

  it('refuses to pair strokes that are nowhere near each other', () => {
    const scribble = shaped.strokes.map((s, i) => s.map((p) => ({ x: p.y * (i ? 1 : -1), y: p.x * 2 })))
    expect(blendWithSample(shaped, scribble, 0).source).toBe('sample')
  })

  it('gives drawn letters the side bearings of their skeleton twin', () => {
    const drawn = prepareSample(samples.find((s) => s.char === 'o')!, cal)
    const base = shapeSkeleton(skeleton.get('o')!, cal.profile)
    const blended = blendWithSample(base, drawn, cal.profile.slant)
    expect(Math.abs(blended.advance - base.advance)).toBeLessThan(base.advance * 0.15)
  })
})

describe('the TrueType writer', () => {
  it('stores a zero delta in no bytes and a small one in one', () => {
    const glyph = encodeGlyph([[{ x: 10, y: 10, on: true }, { x: 10, y: 300, on: true }, { x: 200, y: 300, on: false }]])
    const view = new DataView(glyph.buffer)
    expect(view.getInt16(0)).toBe(1)
    expect([view.getInt16(2), view.getInt16(4), view.getInt16(6), view.getInt16(8)]).toEqual([10, 10, 200, 300])
    // 10 header + 2 endPts + 2 instruction length + 3 flags + x bytes (1, 0, 1) + y bytes (1, 2, 0)
    expect(glyph.length).toBe(24)
  })

  it('produces a file whose checksums all hold', async () => {
    const { ttf } = await buildFont(samples, skeleton, cal, 'Checksum Test')
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
    expect(view.getUint32(0)).toBe(0x00010000)
    const numTables = view.getUint16(4)
    expect(numTables).toBe(10)
    const tags: string[] = []
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16
      const tag = String.fromCharCode(ttf[o]!, ttf[o + 1]!, ttf[o + 2]!, ttf[o + 3]!)
      tags.push(tag)
      const offset = view.getUint32(o + 8)
      const length = view.getUint32(o + 12)
      expect(offset % 4, `${tag} is not 4-byte aligned`).toBe(0)
      const table = ttf.slice(offset, offset + length)
      if (tag === 'head') new DataView(table.buffer).setUint32(8, 0)
      expect(checksum(table), `${tag} checksum`).toBe(view.getUint32(o + 4))
    }
    expect(tags).toEqual([...tags].sort())
    expect(checksum(ttf)).toBe(0xb1b0afba)
  })

  it('is deterministic: the same hand gives the same bytes', async () => {
    const a = await buildFont(samples, skeleton, cal, 'Same')
    const b = await buildFont(structuredClone(samples), skeleton, structuredClone(cal), 'Same')
    expect(Buffer.from(a.ttf).equals(Buffer.from(b.ttf))).toBe(true)
    expect(Buffer.from(a.woff2).equals(Buffer.from(b.woff2))).toBe(true)
  })

  it('is read correctly by a parser that shares no code with it', async () => {
    const { ttf } = await buildFont(samples, skeleton, cal, 'Parse Test')
    const font = opentype.parse(toArrayBuffer(ttf))
    expect(font.unitsPerEm).toBe(1000)
    expect(font.numGlyphs).toBe(92)
    expect(font.names.fontFamily?.en).toBe('Parse Test')
    for (const char of CHARSET) {
      const glyph = font.charToGlyph(char)
      expect(glyph.index, `no glyph for ${char}`).toBeGreaterThan(0)
      expect(glyph.advanceWidth, `no advance for ${char}`).toBeGreaterThan(0)
      expect(glyph.path.commands.length, `empty outline for ${char}`).toBeGreaterThan(3)
    }
    expect(font.charToGlyphIndex(' ')).toBe(1)
    expect(font.charToGlyphIndex('~')).toBe(0)
  })
})

describe('acceptance', () => {
  it('ACCEPTANCE: covers all 90 glyphs with no missing-glyph boxes', async () => {
    const { glyphs } = await buildFont(samples, skeleton, cal, 'Coverage')
    expect(glyphs).toHaveLength(90)
    expect(new Set(glyphs.map((g) => g.char)).size).toBe(90)
    for (const g of glyphs) expect(g.contours.length, `${g.char} has no ink`).toBeGreaterThan(0)
  })

  it('ACCEPTANCE: redrawing one letter updates only that glyph', async () => {
    const before = toFontGlyphs(buildGlyphs(samples, skeleton, cal), cal)
    const redrawn: GlyphSample[] = samples.map((s) =>
      s.char === 'e' ? { char: 'e', strokes: s.strokes.map((st) => st.map((p) => ({ x: p.x * 1.15, y: p.y * 0.9 + 8 }))) } : s,
    )
    // Same calibration: the hand was measured once and is not re-measured.
    const after = toFontGlyphs(buildGlyphs(redrawn, skeleton, cal), cal)
    const changed: string[] = []
    before.forEach((g, i) => {
      const a = Buffer.from(encodeGlyph(g.contours))
      const b = Buffer.from(encodeGlyph(after[i]!.contours))
      if (!a.equals(b) || g.advance !== after[i]!.advance) changed.push(String.fromCodePoint(g.unicode ?? 0xfffd))
    })
    expect(changed).toEqual(['e'])
  })

  it('ACCEPTANCE: exports in well under 5 seconds', async () => {
    const runs: number[] = []
    for (let i = 0; i < 3; i++) runs.push((await buildFont(samples, skeleton, cal, 'Timing')).ms)
    const worst = Math.max(...runs)
    console.log(`export time over 3 runs: ${runs.map((r) => r.toFixed(0)).join(', ')} ms`)
    expect(worst).toBeLessThan(5000)
    expect(worst).toBeLessThan(1500)
  })

  it.runIf(process.platform === 'darwin')('ACCEPTANCE: macOS CoreText loads it and finds ink in all 90 glyphs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'glyphsmith-'))
    for (const demo of DEMO_HANDS) {
      const s = synthSamples(skeleton, demo.profile)
      const { ttf } = await buildFont(s, skeleton, calibrate(s, skeleton, demo.profile.strokeWidth), `Check ${demo.name}`)
      const file = path.join(dir, `${demo.name}.ttf`)
      writeFileSync(file, ttf)
      const report = JSON.parse(execFileSync('swift', ['scripts/coretext-check.swift', file], { encoding: 'utf8' }))
      expect(report, demo.name).toMatchObject({ ok: true, checked: 90, missing: '', inkless: '', glyphCount: 92 })
    }
  }, 120_000)

  it.runIf(existsSync('.venv/bin/python'))('fontTools agrees, for the TTF and the WOFF2', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'glyphsmith-'))
    const { ttf, woff2 } = await buildFont(samples, skeleton, cal, 'FontTools Test')
    writeFileSync(path.join(dir, 'f.ttf'), ttf)
    writeFileSync(path.join(dir, 'f.woff2'), woff2)
    const report = JSON.parse(execFileSync('.venv/bin/python', ['scripts/validate_font.py', path.join(dir, 'f.ttf'), path.join(dir, 'f.woff2')], { encoding: 'utf8' }))
    expect(report.ok).toBe(true)
    expect(report.fonts.map((f: { flavor: string }) => f.flavor)).toEqual(['ttf', 'woff2'])
    expect(report.fonts[0].glyphs).toBe(92)
  }, 60_000)
})

describe('WOFF2', () => {
  it('writes a stored Brotli stream that a real decoder accepts', () => {
    for (const size of [0, 1, 500, 65536, 65537, 200_000]) {
      const data = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff)
      const decoded = zlib.brotliDecompressSync(brotliStored(data))
      expect(Buffer.from(decoded).equals(Buffer.from(data)), `size ${size}`).toBe(true)
    }
  })

  it('carries exactly the tables of the TTF, and is smaller', async () => {
    const { ttf, woff2 } = await buildFont(samples, skeleton, cal, 'Woff Test')
    const view = new DataView(woff2.buffer, woff2.byteOffset, woff2.byteLength)
    expect(String.fromCharCode(...woff2.slice(0, 4))).toBe('wOF2')
    expect(view.getUint32(8)).toBe(woff2.length)
    expect(view.getUint16(12)).toBe(10)
    expect(view.getUint32(16)).toBe(ttf.length)
    expect(woff2.length).toBeLessThan(ttf.length * 0.7)
  })

  it('still yields a valid file when no compressor is available', async () => {
    const { ttf } = await buildFont(samples, skeleton, cal, 'Fallback')
    const tables = new Map<string, Uint8Array>()
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
    for (let i = 0; i < view.getUint16(4); i++) {
      const o = 12 + i * 16
      tables.set(String.fromCharCode(...ttf.slice(o, o + 4)), ttf.slice(view.getUint32(o + 8), view.getUint32(o + 8) + view.getUint32(o + 12)))
    }
    const stored = await buildWoff2(tables, brotliStored)
    // Walk the table directory to find where the compressed stream starts.
    let cursor = 48
    let expected = 0
    for (let i = 0; i < 10; i++) {
      if ((stored[cursor]! & 0x3f) === 63) cursor += 4
      cursor += 1
      let length = 0
      for (;;) {
        const byte = stored[cursor++]!
        length = (length << 7) | (byte & 0x7f)
        if (!(byte & 0x80)) break
      }
      expected += length
    }
    const compressedLength = new DataView(stored.buffer).getUint32(20)
    const payload = zlib.brotliDecompressSync(stored.slice(cursor, cursor + compressedLength))
    expect(payload.length).toBe(expected)
    expect(payload.length).toBeGreaterThan(20_000)
  })
})
