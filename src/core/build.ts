import { loadBrotli, buildWoff2 } from '../font/woff2'
import type { Brotli } from '../font/woff2'
import type { FontGlyph, FontInfo } from '../font/sfnt'
import { assembleSfnt, buildTables } from '../font/sfnt'
import type { Calibration, ShapedGlyph } from './deform'
import { blendWithSample, prepareSample, shapeSkeleton } from './deform'
import type { SkeletonGlyph } from './hershey'
import { measureStyle, sampleNormalisation } from './measure'
import type { Contour } from './outline'
import { outlineStrokes } from './outline'
import type { GlyphSample } from './types'
import { ASCENDER, CHARSET, EM, LINE_ASCENT, LINE_DESCENT } from './types'

export interface BuiltGlyph extends ShapedGlyph {
  contours: Contour[]
}

/** Measures the hand once. The result is frozen until someone asks to re-measure. */
export function calibrate(samples: GlyphSample[], skeleton: Map<string, SkeletonGlyph>, penWidth?: number): Calibration {
  const { scale, baseline } = sampleNormalisation(samples)
  return { profile: measureStyle(samples, { penWidth, skeleton }), scale, baseline }
}

/**
 * Builds one glyph. It depends on the calibration, the skeleton for that
 * character, and that character's own sample: nothing else. Redrawing an "e"
 * therefore cannot touch any other glyph, and a test holds it to that.
 */
export function buildGlyph(char: string, skeleton: Map<string, SkeletonGlyph>, cal: Calibration, sample?: GlyphSample): BuiltGlyph {
  const base = skeleton.get(char)
  if (!base) throw new Error(`the skeleton font has no "${char}"`)
  let shaped = shapeSkeleton(base, cal.profile)
  if (sample && sample.strokes.some((s) => s.length > 1)) {
    shaped = blendWithSample(shaped, prepareSample(sample, cal), cal.profile.slant)
  }
  return { ...shaped, contours: outlineStrokes(shaped.strokes, cal.profile.strokeWidth, cal.profile.terminal) }
}

export function buildGlyphs(samples: GlyphSample[], skeleton: Map<string, SkeletonGlyph>, cal: Calibration): BuiltGlyph[] {
  const byChar = new Map(samples.map((s) => [s.char, s]))
  return CHARSET.map((char) => buildGlyph(char, skeleton, cal, byChar.get(char)))
}

/** The box a system draws when a font has no glyph for a character. */
const NOTDEF: Contour[] = [
  [{ x: 60, y: 0, on: true }, { x: 60, y: 700, on: true }, { x: 440, y: 700, on: true }, { x: 440, y: 0, on: true }],
  [{ x: 110, y: 50, on: true }, { x: 390, y: 50, on: true }, { x: 390, y: 650, on: true }, { x: 110, y: 650, on: true }],
]

export function toFontGlyphs(built: BuiltGlyph[], cal: Calibration): FontGlyph[] {
  const visible = built
    .map((g) => ({ unicode: g.char.codePointAt(0)!, advance: g.advance, contours: g.contours }))
    .sort((a, b) => a.unicode - b.unicode)
  const spaceAdvance = Math.round(280 * cal.profile.widthScale)
  return [
    { unicode: null, advance: 500, contours: NOTDEF },
    { unicode: 32, advance: spaceAdvance, contours: [] },
    ...visible,
  ]
}

export function fontInfo(familyName: string, cal: Calibration): FontInfo {
  return {
    familyName,
    unitsPerEm: EM,
    ascent: LINE_ASCENT,
    descent: LINE_DESCENT,
    xHeight: Math.round(cal.profile.xHeightRatio * ASCENDER),
    capHeight: ASCENDER,
    slant: cal.profile.slant,
  }
}

export interface FontFiles {
  ttf: Uint8Array
  woff2: Uint8Array
  glyphs: BuiltGlyph[]
  /** Wall time for the whole export, in milliseconds. */
  ms: number
}

/** Samples in, installable font out. */
export async function buildFont(
  samples: GlyphSample[],
  skeleton: Map<string, SkeletonGlyph>,
  cal: Calibration,
  familyName: string,
  brotli?: Brotli,
): Promise<FontFiles> {
  const started = performance.now()
  const glyphs = buildGlyphs(samples, skeleton, cal)
  const tables = buildTables(toFontGlyphs(glyphs, cal), fontInfo(familyName, cal))
  const ttf = assembleSfnt(tables)
  const woff2 = await buildWoff2(tables, brotli ?? (await loadBrotli()))
  return { ttf, woff2, glyphs, ms: performance.now() - started }
}
