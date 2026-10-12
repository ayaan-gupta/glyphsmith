import { describe, expect, it } from 'vitest'
import { calibrate } from '@/core/build'
import { measureStyle } from '@/core/measure'
import { synthSamples } from '@/core/synth'
import type { Point, Stroke, StyleProfile } from '@/core/types'
import { DEFAULT_PROFILE } from '@/core/types'
import { components, drawStroke, fromRgba, gray, inkMask, otsu } from '@/raster/image'
import { cells, extractFromPhoto, findMarks, homography, MARKS, photograph, project, renderSheet, SHEET, templateSvg } from '@/raster/template'
import { distanceToPaper, thin, traceSkeleton } from '@/raster/trace'
import { skeleton } from './helpers'

function vectorise(strokes: Stroke[], penWidth: number, size = 200) {
  const img = gray(size, size)
  for (const s of strokes) drawStroke(img, s, penWidth)
  const mask = inkMask(img, 128)
  return traceSkeleton(thin(mask, size, size), distanceToPaper(mask, size, size), size, size)
}

const lengthOf = (pts: Point[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) : 0), 0)

/** Mean distance from each point of `a` to the nearest point on any stroke of `b`. */
function meanGap(a: Stroke[], b: Stroke[]): number {
  const target = b.flatMap((s) => {
    const dense: Point[] = []
    for (let i = 1; i < s.length; i++) for (let t = 0; t < 1; t += 0.1) dense.push({ x: s[i - 1]!.x + (s[i]!.x - s[i - 1]!.x) * t, y: s[i - 1]!.y + (s[i]!.y - s[i - 1]!.y) * t })
    return dense
  })
  const pts = a.flat()
  if (!pts.length || !target.length) return Infinity
  return pts.reduce((sum, p) => sum + Math.min(...target.map((q) => Math.hypot(p.x - q.x, p.y - q.y))), 0) / pts.length
}

describe('thresholding', () => {
  it('finds the valley between ink and paper', () => {
    const img = gray(100, 100, 230)
    drawStroke(img, [{ x: 10, y: 50 }, { x: 90, y: 50 }], 8, 30)
    const t = otsu(img)
    expect(t).toBeGreaterThan(30)
    expect(t).toBeLessThan(230)
    expect(inkMask(img, t).reduce((a, b) => a + b, 0)).toBeGreaterThan(500)
  })

  it('converts RGBA with luma weights', () => {
    const g = fromRgba(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1)
    expect([...g.data]).toEqual([255, 0, 76])
  })

  it('labels separate blobs separately', () => {
    const img = gray(60, 30)
    drawStroke(img, [{ x: 10, y: 15 }], 10)
    drawStroke(img, [{ x: 45, y: 15 }], 14)
    const found = components(inkMask(img, 128), 60, 30).sort((a, b) => a.cx - b.cx)
    expect(found).toHaveLength(2)
    expect(found[0]!.cx).toBeCloseTo(10, 0)
    expect(found[1]!.area).toBeGreaterThan(found[0]!.area)
  })
})

describe('raster to centreline', () => {
  it('reduces a thick line to one stroke down its middle and recovers the pen width', () => {
    const strokes = vectorise([[{ x: 40, y: 30 }, { x: 150, y: 160 }]], 11)
    expect(strokes).toHaveLength(1)
    const s = strokes[0]!
    // Thinning eats about half a pen width off each end.
    expect(Math.abs(lengthOf(s.points) - Math.hypot(110, 130))).toBeLessThan(16)
    const mid = s.widths[s.widths.length >> 1]!
    expect(Math.abs(mid - 11)).toBeLessThan(2.5)
    for (const p of s.points) expect(Math.abs((p.x - 40) * 130 - (p.y - 30) * 110) / Math.hypot(110, 130)).toBeLessThan(2)
  })

  it('returns a closed loop for an o', () => {
    const o: Stroke = Array.from({ length: 73 }, (_, i) => ({ x: 100 + 55 * Math.cos((i * 5 * Math.PI) / 180), y: 100 + 70 * Math.sin((i * 5 * Math.PI) / 180) }))
    const strokes = vectorise([o], 9)
    expect(strokes).toHaveLength(1)
    expect(strokes[0]!.closed).toBe(true)
    expect(Math.abs(lengthOf(strokes[0]!.points) - 394) / 394).toBeLessThan(0.12)
  })

  it('splits a t into a stem and a crossbar, not four arms', () => {
    const strokes = vectorise([[{ x: 100, y: 20 }, { x: 100, y: 180 }], [{ x: 50, y: 70 }, { x: 150, y: 70 }]], 9)
    expect(strokes).toHaveLength(2)
    const spans = strokes.map((s) => ({ w: Math.max(...s.points.map((p) => p.x)) - Math.min(...s.points.map((p) => p.x)), h: Math.max(...s.points.map((p) => p.y)) - Math.min(...s.points.map((p) => p.y)) }))
    expect(spans.some((b) => b.h > 130 && b.w < 12)).toBe(true)
    expect(spans.some((b) => b.w > 80 && b.h < 12)).toBe(true)
  })

  it('splits an h into a stem and an arch', () => {
    const arch: Stroke = [{ x: 60, y: 110 }, ...Array.from({ length: 19 }, (_, i) => ({ x: 95 - 35 * Math.cos((i * 10 * Math.PI) / 180), y: 110 - 35 * Math.sin((i * 10 * Math.PI) / 180) })), { x: 130, y: 180 }]
    const strokes = vectorise([[{ x: 60, y: 20 }, { x: 60, y: 180 }], arch], 9)
    expect(strokes).toHaveLength(2)
    const tall = strokes.find((s) => Math.max(...s.points.map((p) => p.y)) - Math.min(...s.points.map((p) => p.y)) > 140 && Math.max(...s.points.map((p) => p.x)) - Math.min(...s.points.map((p) => p.x)) < 12)
    expect(tall).toBeDefined()
  })

  it('does not leave spurs on a fat blunt stroke', () => {
    expect(vectorise([[{ x: 30, y: 100 }, { x: 170, y: 100 }]], 24)).toHaveLength(1)
  })
})

describe('the template geometry', () => {
  it('solves a homography that maps its four points exactly', () => {
    const to = [{ x: 31, y: 48 }, { x: 900, y: 20 }, { x: 960, y: 1300 }, { x: 5, y: 1250 }]
    const h = homography(MARKS, to)
    MARKS.forEach((m, i) => {
      const p = project(h, m)
      expect(p.x).toBeCloseTo(to[i]!.x, 6)
      expect(p.y).toBeCloseTo(to[i]!.y, 6)
    })
  })

  it('lays out ten cells inside the registration marks', () => {
    const all = cells()
    expect(all.map((c) => c.char).join('')).toBe('aeotnrshld')
    for (const c of all) {
      expect(c.x).toBeGreaterThan(MARKS[0]!.x + 22)
      expect(c.y + 200).toBeLessThan(MARKS[2]!.y - 22)
    }
    const svg = templateSvg()
    expect(svg.match(/<rect /g)!.length).toBe(1 + 4 + 10)
    expect(svg).toContain(`viewBox="0 0 ${SHEET.width} ${SHEET.height}"`)
  })
})

describe('importing a photographed template', () => {
  const truth: StyleProfile = { ...DEFAULT_PROFILE, slant: 12, strokeWidth: 48, xHeightRatio: 0.62, roundness: 0.8 }
  const written = synthSamples(skeleton, truth).map((s) => ({
    char: s.char,
    // Shift each letter in from the cell edge, as a person would.
    strokes: s.strokes.map((st) => st.map((p) => ({ x: p.x + 500, y: p.y }))),
  }))
  const sheet = renderSheet(written, 48)
  // The page seen from above and to one side: every edge a different length.
  const photo = photograph(sheet, 1500, 2000, [{ x: 130, y: 90 }, { x: 1390, y: 150 }, { x: 1440, y: 1900 }, { x: 60, y: 1830 }])

  it('finds the four registration squares in a skewed, unevenly lit photo', () => {
    const marks = findMarks(photo)!
    expect(marks).toHaveLength(4)
    const expected = homography(
      [{ x: 0, y: 0 }, { x: sheet.width, y: 0 }, { x: sheet.width, y: sheet.height }, { x: 0, y: sheet.height }],
      [{ x: 130, y: 90 }, { x: 1390, y: 150 }, { x: 1440, y: 1900 }, { x: 60, y: 1830 }],
    )
    MARKS.forEach((m, i) => {
      const p = project(expected, { x: m.x * 2, y: m.y * 2 })
      expect(Math.hypot(marks[i]!.x - p.x, marks[i]!.y - p.y), `mark ${i}`).toBeLessThan(4)
    })
  })

  it('returns null instead of guessing when there is no template in the picture', () => {
    expect(extractFromPhoto(gray(600, 800, 200))).toBeNull()
  })

  it('recovers every letter close to what was written', () => {
    const result = extractFromPhoto(photo)!
    expect(result.samples).toHaveLength(10)
    for (const s of result.samples) {
      const original = written.find((w) => w.char === s.char)!
      expect(s.strokes.length, `${s.char} came back empty`).toBeGreaterThan(0)
      // Both directions: nothing missing, nothing invented.
      expect(meanGap(s.strokes, original.strokes), `${s.char} recovered to wrong place`).toBeLessThan(14)
      expect(meanGap(original.strokes, s.strokes), `${s.char} lost part of the letter`).toBeLessThan(22)
    }
  })

  it('measures the same hand from the photo as from the pen', () => {
    const result = extractFromPhoto(photo)!
    const measured = measureStyle(result.samples, { penWidth: result.penWidth, widthProfiles: result.widthProfiles, skeleton })
    expect(Math.abs(measured.slant - 12), `slant read as ${measured.slant.toFixed(1)}`).toBeLessThan(3)
    expect(Math.abs(measured.xHeightRatio - 0.62)).toBeLessThan(0.06)
    expect(Math.abs(measured.strokeWidth - 48) / 48).toBeLessThan(0.3)
    const cal = calibrate(result.samples, skeleton, result.penWidth)
    expect(cal.scale).toBeGreaterThan(0.9)
    expect(cal.scale).toBeLessThan(1.1)
  })
})
