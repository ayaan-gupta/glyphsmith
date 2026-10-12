import type { Contour } from '../core/outline'
import { checksum, padded, Writer } from './binary'

export interface FontGlyph {
  /** Code point, or null for .notdef. */
  unicode: number | null
  advance: number
  contours: Contour[]
}

export interface FontInfo {
  familyName: string
  unitsPerEm: number
  ascent: number
  descent: number
  xHeight: number
  capHeight: number
  /** Degrees, positive leaning right. Stored negated, as the format expects. */
  slant: number
  /** Seconds since 1904-01-01. Fixed by default so equal input gives equal bytes. */
  timestamp?: number
}

// 2026-01-01T00:00:00Z in the font epoch. A real clock here would make every
// export differ and the "only one glyph changed" test impossible to write.
const DEFAULT_TIMESTAMP = 3850070400

interface Bounds { xMin: number; yMin: number; xMax: number; yMax: number }

function glyphBounds(contours: Contour[]): Bounds | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const c of contours)
    for (const p of c) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
  return Number.isFinite(xMin) ? { xMin, yMin, xMax, yMax } : null
}

const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const X_SAME_OR_POSITIVE = 0x10
const Y_SAME_OR_POSITIVE = 0x20

/**
 * One simple glyph in the `glyf` format. Coordinates are stored as deltas
 * from the previous point: nothing at all when a delta is zero, one byte with
 * the sign in a flag when it fits, two bytes otherwise.
 */
export function encodeGlyph(contours: Contour[]): Uint8Array {
  const bounds = glyphBounds(contours)
  if (!bounds) return new Uint8Array(0)
  const w = new Writer()
  w.i16(contours.length).i16(bounds.xMin).i16(bounds.yMin).i16(bounds.xMax).i16(bounds.yMax)

  let end = -1
  for (const c of contours) {
    end += c.length
    w.u16(end)
  }
  w.u16(0) // no hinting instructions

  const flags: number[] = []
  const xs = new Writer()
  const ys = new Writer()
  let px = 0
  let py = 0
  for (const c of contours)
    for (const p of c) {
      let flag = p.on ? ON_CURVE : 0
      const dx = p.x - px
      const dy = p.y - py
      if (dx === 0) flag |= X_SAME_OR_POSITIVE
      else if (Math.abs(dx) < 256) {
        flag |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0)
        xs.u8(Math.abs(dx))
      } else xs.i16(dx)
      if (dy === 0) flag |= Y_SAME_OR_POSITIVE
      else if (Math.abs(dy) < 256) {
        flag |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0)
        ys.u8(Math.abs(dy))
      } else ys.i16(dy)
      flags.push(flag)
      px = p.x
      py = p.y
    }
  for (const f of flags) w.u8(f)
  w.bytes(xs.done()).bytes(ys.done())
  return w.pad(4).done()
}

function buildCmap(glyphs: FontGlyph[]): Uint8Array {
  // Glyphs are in code point order, so every run of consecutive code points
  // is one segment with a constant offset to the glyph index.
  const segments: Array<{ start: number; end: number; delta: number }> = []
  glyphs.forEach((g, index) => {
    if (g.unicode === null) return
    const last = segments[segments.length - 1]
    if (last && g.unicode === last.end + 1 && index - g.unicode === last.delta) last.end = g.unicode
    else segments.push({ start: g.unicode, end: g.unicode, delta: index - g.unicode })
  })
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 })

  const segCount = segments.length
  const entrySelector = Math.floor(Math.log2(segCount))
  const searchRange = 2 * 2 ** entrySelector
  const sub = new Writer()
  sub.u16(4).u16(16 + segCount * 8).u16(0)
  sub.u16(segCount * 2).u16(searchRange).u16(entrySelector).u16(segCount * 2 - searchRange)
  for (const s of segments) sub.u16(s.end)
  sub.u16(0)
  for (const s of segments) sub.u16(s.start)
  for (const s of segments) sub.u16(s.delta & 0xffff)
  for (let i = 0; i < segCount; i++) sub.u16(0)

  const w = new Writer()
  w.u16(0).u16(2)
  w.u16(0).u16(3).u32(20) // Unicode, BMP
  w.u16(3).u16(1).u32(20) // Windows, Unicode BMP
  w.bytes(sub.done())
  return w.done()
}

function buildName(info: FontInfo): Uint8Array {
  const postScript = info.familyName.replace(/[^A-Za-z0-9-]/g, '') || 'Glyphsmith'
  const names: Array<[number, string]> = [
    [1, info.familyName],
    [2, 'Regular'],
    [3, `Glyphsmith:${postScript}`],
    [4, info.familyName],
    [5, 'Version 1.000'],
    [6, `${postScript}-Regular`],
  ]
  const strings = new Writer()
  const records: Array<[number, number, number, number, number, number]> = []
  // Macintosh Roman first, then Windows UTF-16BE: records must be sorted.
  for (const [id, text] of names) {
    const start = strings.length
    for (const ch of text) strings.u8(ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 63)
    records.push([1, 0, 0, id, strings.length - start, start])
  }
  for (const [id, text] of names) {
    const start = strings.length
    for (let i = 0; i < text.length; i++) strings.u16(text.charCodeAt(i))
    records.push([3, 1, 0x409, id, strings.length - start, start])
  }
  const w = new Writer()
  w.u16(0).u16(records.length).u16(6 + records.length * 12)
  for (const r of records) for (const v of r) w.u16(v)
  w.bytes(strings.done())
  return w.done()
}

/** Builds every table of a TrueType font. Glyph 0 must be .notdef; the rest in code point order. */
export function buildTables(glyphs: FontGlyph[], info: FontInfo): Map<string, Uint8Array> {
  if (glyphs.length === 0 || glyphs[0]!.unicode !== null) throw new Error('glyph 0 must be .notdef')
  for (let i = 2; i < glyphs.length; i++) {
    if ((glyphs[i]!.unicode ?? -1) <= (glyphs[i - 1]!.unicode ?? -1)) throw new Error('glyphs must be in code point order')
  }

  const glyf = new Writer()
  const offsets: number[] = []
  const all: Bounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  let maxPoints = 0
  let maxContours = 0
  let advanceMax = 0
  let minLsb = Infinity
  let minRsb = Infinity
  let maxExtent = -Infinity
  const hmtx = new Writer()

  for (const g of glyphs) {
    offsets.push(glyf.length)
    glyf.bytes(encodeGlyph(g.contours))
    const b = glyphBounds(g.contours)
    const advance = Math.max(0, Math.round(g.advance))
    hmtx.u16(advance).i16(b ? b.xMin : 0)
    advanceMax = Math.max(advanceMax, advance)
    if (!b) continue
    all.xMin = Math.min(all.xMin, b.xMin); all.yMin = Math.min(all.yMin, b.yMin)
    all.xMax = Math.max(all.xMax, b.xMax); all.yMax = Math.max(all.yMax, b.yMax)
    maxPoints = Math.max(maxPoints, g.contours.reduce((n, c) => n + c.length, 0))
    maxContours = Math.max(maxContours, g.contours.length)
    minLsb = Math.min(minLsb, b.xMin)
    minRsb = Math.min(minRsb, advance - b.xMax)
    maxExtent = Math.max(maxExtent, b.xMax)
  }
  offsets.push(glyf.length)
  if (!Number.isFinite(all.xMin)) Object.assign(all, { xMin: 0, yMin: 0, xMax: 0, yMax: 0 })

  const loca = new Writer()
  for (const o of offsets) loca.u32(o)

  const timestamp = info.timestamp ?? DEFAULT_TIMESTAMP
  const head = new Writer()
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5)
  head.u16(0x0003).u16(info.unitsPerEm)
  head.u32(0).u32(timestamp).u32(0).u32(timestamp)
  head.i16(all.xMin).i16(all.yMin).i16(all.xMax).i16(all.yMax)
  head.u16(0).u16(8).i16(2).i16(1).i16(0) // macStyle, lowestRecPPEM, direction hint, long loca, glyph format

  const hhea = new Writer()
  hhea.u32(0x00010000).i16(info.ascent).i16(info.descent).i16(0)
  hhea.u16(advanceMax).i16(Number.isFinite(minLsb) ? minLsb : 0).i16(Number.isFinite(minRsb) ? minRsb : 0)
  hhea.i16(Number.isFinite(maxExtent) ? maxExtent : 0)
  hhea.i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length)

  const maxp = new Writer()
  maxp.u32(0x00010000).u16(glyphs.length).u16(maxPoints).u16(maxContours)
  maxp.u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0)

  const codes = glyphs.map((g) => g.unicode).filter((u): u is number => u !== null)
  const avgWidth = Math.round(glyphs.reduce((n, g) => n + g.advance, 0) / glyphs.length)
  const os2 = new Writer()
  os2.u16(4).i16(avgWidth).u16(400).u16(5).u16(0)
  os2.i16(650).i16(600).i16(0).i16(75) // subscript
  os2.i16(650).i16(600).i16(0).i16(350) // superscript
  os2.i16(50).i16(Math.round(info.xHeight / 2)) // strikeout
  os2.i16(0)
  for (const b of [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]) os2.u8(b) // PANOSE: Latin hand written, the rest "any"
  os2.u32(1).u32(0).u32(0).u32(0) // Basic Latin
  os2.tag('GLYS')
  os2.u16(0x00c0) // REGULAR and USE_TYPO_METRICS
  os2.u16(Math.min(...codes)).u16(Math.max(...codes))
  os2.i16(info.ascent).i16(info.descent).i16(0)
  os2.u16(Math.max(info.ascent, all.yMax)).u16(Math.max(-info.descent, -all.yMin))
  os2.u32(1).u32(0) // code page 1252
  os2.i16(info.xHeight).i16(info.capHeight).u16(0).u16(32).u16(0)

  const post = new Writer()
  post.u32(0x00030000).i32(Math.round(-info.slant * 65536)).i16(-120).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0)

  return new Map<string, Uint8Array>([
    ['OS/2', os2.done()],
    ['cmap', buildCmap(glyphs)],
    ['glyf', glyf.done()],
    ['head', head.done()],
    ['hhea', hhea.done()],
    ['hmtx', hmtx.done()],
    ['loca', loca.done()],
    ['maxp', maxp.done()],
    ['name', buildName(info)],
    ['post', post.done()],
  ])
}

/** Wraps tables in the sfnt container: directory, padding, and the whole-file checksum. */
export function assembleSfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const n = tags.length
  const entrySelector = Math.floor(Math.log2(n))
  const searchRange = 16 * 2 ** entrySelector

  const w = new Writer()
  w.u32(0x00010000).u16(n).u16(searchRange).u16(entrySelector).u16(n * 16 - searchRange)
  let offset = 12 + n * 16
  let headOffset = 0
  for (const tag of tags) {
    const data = tables.get(tag)!
    if (tag === 'head') headOffset = offset
    w.tag(tag.padEnd(4, ' ')).u32(checksum(data)).u32(offset).u32(data.length)
    offset += padded(data.length)
  }
  for (const tag of tags) w.bytes(tables.get(tag)!).pad(4)

  const out = w.done()
  // checkSumAdjustment makes the checksum of the entire file come to a magic
  // constant. It is computed with the field itself still zero.
  const adjustment = (0xb1b0afba - checksum(out)) >>> 0
  new DataView(out.buffer).setUint32(headOffset + 8, adjustment)
  return out
}

export function buildTtf(glyphs: FontGlyph[], info: FontInfo): Uint8Array {
  return assembleSfnt(buildTables(glyphs, info))
}
