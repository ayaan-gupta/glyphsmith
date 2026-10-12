import { ASCENDER } from './types'
import type { Stroke } from './types'

export interface SkeletonGlyph {
  char: string
  /** Centreline strokes in font units, left bearing already at x = 0. */
  strokes: Stroke[]
  advance: number
}

// Hershey Simplex draws capitals 21 units tall, from y = -12 down to a
// baseline at y = 9, with y growing downward. Everything is measured from 'R'.
const ORIGIN = 'R'.charCodeAt(0)
const BASELINE = 9
const CAP_UNITS = 21
export const HERSHEY_SCALE = ASCENDER / CAP_UNITS

/**
 * Parses one record of a JHF file.
 *
 * Columns 0 to 4 hold a glyph number, 5 to 7 the count of coordinate pairs
 * (the first pair being the left and right bearings), and the rest is pairs
 * of characters whose distance from 'R' is the coordinate. The pair " R"
 * means pen up.
 */
export function parseJhfLine(line: string, char: string): SkeletonGlyph | null {
  if (line.length < 10) return null
  const count = Number(line.slice(5, 8))
  if (!Number.isFinite(count) || count < 1) return null
  const left = line.charCodeAt(8) - ORIGIN
  const right = line.charCodeAt(9) - ORIGIN

  const strokes: Stroke[] = []
  let current: Stroke = []
  const body = line.slice(10)
  for (let i = 0; i + 1 < body.length && i / 2 < count - 1; i += 2) {
    if (body[i] === ' ' && body[i + 1] === 'R') {
      if (current.length) strokes.push(current)
      current = []
      continue
    }
    const x = body.charCodeAt(i) - ORIGIN
    const y = body.charCodeAt(i + 1) - ORIGIN
    current.push({ x: (x - left) * HERSHEY_SCALE, y: (BASELINE - y) * HERSHEY_SCALE })
  }
  if (current.length) strokes.push(current)
  return { char, strokes, advance: (right - left) * HERSHEY_SCALE }
}

/** A JHF file for one font lists ASCII 32 through 127 in order, one per line. */
export function parseJhf(text: string): Map<string, SkeletonGlyph> {
  const glyphs = new Map<string, SkeletonGlyph>()
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  lines.forEach((line, i) => {
    const char = String.fromCharCode(32 + i)
    const glyph = parseJhfLine(line, char)
    if (glyph) glyphs.set(char, glyph)
  })
  return glyphs
}
