export interface Point {
  x: number
  y: number
}

/** A pen path. Font units, y pointing up, baseline at y = 0. */
export type Stroke = Point[]

export interface GlyphSample {
  char: string
  strokes: Stroke[]
}

export type Terminal = 'round' | 'flat' | 'tapered'

/**
 * Everything Glyphsmith learns about a hand. The first five fields are the
 * ones the spec names; width and terminal came out of needing them.
 */
export interface StyleProfile {
  /** Degrees from vertical. Positive leans right. */
  slant: number
  /** Pen width in font units. */
  strokeWidth: number
  /** x-height divided by ascender height. */
  xHeightRatio: number
  /** 0 is all corners, 1 is all curves. */
  roundness: number
  /** Standard deviation of where letters sit, as a fraction of x-height. */
  wobble: number
  /** How wide the letters run compared with the skeleton. */
  widthScale: number
  terminal: Terminal
}

export const EM = 1000
export const ASCENDER = 720
export const X_HEIGHT = 480
export const DESCENDER = -240
/** Line metrics leave air above the ascender for wobble and tall strokes. */
export const LINE_ASCENT = 800
export const LINE_DESCENT = -280

/** The ten letters a person draws. Chosen to cover stems, bowls, arches and an s-curve. */
export const SAMPLE_CHARS = ['a', 'e', 'o', 't', 'n', 'r', 's', 'h', 'l', 'd'] as const

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const PUNCTUATION = '.,;:!?\'"-()[]{}/\\&@#$%*+=<>_'

/** The 90 visible glyphs the font covers. Space and .notdef are added on top. */
export const CHARSET: readonly string[] = [...(UPPER + LOWER + DIGITS + PUNCTUATION)]

export const DEFAULT_PROFILE: StyleProfile = {
  slant: 0,
  strokeWidth: 56,
  xHeightRatio: X_HEIGHT / ASCENDER,
  roundness: 0.5,
  wobble: 0,
  widthScale: 1,
  terminal: 'round',
}

export const isLower = (char: string): boolean => char >= 'a' && char <= 'z'
