import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseJhf } from '@/core/hershey'
import type { GlyphSample, Point, Stroke } from '@/core/types'

export const skeleton = parseJhf(readFileSync(path.join(process.cwd(), 'vendor/hershey/futural.jhf'), 'utf8'))

const line = (x0: number, y0: number, x1: number, y1: number): Stroke => {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 12))
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }))
}

/** An elliptical arc from angle a0 to a1 (degrees, counter-clockwise from +x). */
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Stroke => {
  const n = Math.max(6, Math.round(Math.abs(a1 - a0) / 8))
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }
  })
}

/**
 * Ten letters built from straight lines and elliptical arcs, with no help
 * from the skeleton font or the deformation code. This is the independent
 * hand the measurement tests are judged against.
 */
export function primitiveHand(options: { slant?: number; xHeight?: number; ascender?: number; baseline?: number } = {}): GlyphSample[] {
  const { slant = 0, xHeight = 480, ascender = 720, baseline = 0 } = options
  const r = xHeight / 2
  const upright: Record<string, Stroke[]> = {
    a: [arc(200, r, 180, r, 20, 340), line(380, xHeight, 380, 0)],
    e: [line(40, r, 400, r), arc(220, r, 180, r, 0, 320)],
    o: [arc(220, r, 190, r, 90, 450)],
    t: [line(140, ascender * 0.9, 140, 0), line(20, xHeight, 280, xHeight)],
    n: [line(60, xHeight, 60, 0), arc(220, xHeight - 160, 160, 160, 180, 0), line(380, xHeight - 160, 380, 0)],
    r: [line(60, xHeight, 60, 0), arc(220, xHeight - 160, 160, 160, 180, 60)],
    s: [arc(200, xHeight * 0.75, 150, xHeight * 0.25, 30, 270), arc(200, xHeight * 0.25, 150, xHeight * 0.25, 90, -150)],
    h: [line(60, ascender, 60, 0), arc(220, xHeight - 160, 160, 160, 180, 0), line(380, xHeight - 160, 380, 0)],
    l: [line(60, ascender, 60, 0)],
    d: [arc(200, r, 180, r, 20, 340), line(380, ascender, 380, 0)],
  }
  const shear = Math.tan((slant * Math.PI) / 180)
  const lean = (p: Point): Point => ({ x: p.x + p.y * shear, y: p.y + baseline })
  return Object.entries(upright).map(([char, strokes]) => ({ char, strokes: strokes.map((s) => s.map(lean)) }))
}
