import { simplify } from '../core/geom'
import type { GlyphSample, Point } from '../core/types'
import { ASCENDER, DESCENDER, SAMPLE_CHARS, X_HEIGHT } from '../core/types'
import type { Gray } from './image'
import { components, downscale, gray, inkMask, otsu, sample } from './image'
import { distanceToPaper, thin, traceSkeleton } from './trace'

/**
 * The printable sheet, in sheet units. The page is 1000 wide with A4
 * proportions, so on A4 one unit is 0.21 mm and letters come out about 2 cm
 * tall.
 */
export const SHEET = { width: 1000, height: 1414 }
const MARK = 44
/** Centres of the four black registration squares. */
export const MARKS: Point[] = [
  { x: 62, y: 62 },
  { x: SHEET.width - 62, y: 62 },
  { x: SHEET.width - 62, y: SHEET.height - 62 },
  { x: 62, y: SHEET.height - 62 },
]

const CELL = { width: 370, height: 200, left: 110, top: 232, gapX: 40, gapY: 24 }
/** Font units per sheet unit inside a cell: the ascender guide sits 100 units above the baseline. */
const UNITS = ASCENDER / 100
const BASELINE = 130

export interface Cell {
  char: string
  x: number
  y: number
}

export function cells(): Cell[] {
  return SAMPLE_CHARS.map((char, i) => ({
    char,
    x: CELL.left + (i % 2) * (CELL.width + CELL.gapX),
    y: CELL.top + Math.floor(i / 2) * (CELL.height + CELL.gapY),
  }))
}

const GUIDE = '#b9d3f0'

/** The template as an SVG document. Guides are pale blue so a threshold drops them. */
export function templateSvg(): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.width} ${SHEET.height}" width="210mm" height="297mm">`,
    `<rect width="${SHEET.width}" height="${SHEET.height}" fill="#ffffff"/>`,
  ]
  for (const m of MARKS) parts.push(`<rect x="${m.x - MARK / 2}" y="${m.y - MARK / 2}" width="${MARK}" height="${MARK}" fill="#000000"/>`)
  parts.push(
    `<text x="110" y="128" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#1b3a73">Glyphsmith</text>`,
    `<text x="110" y="164" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#6f7f99">Write each letter once, in dark ink, sitting on the heavier line. Then photograph the whole page, corners included.</text>`,
  )
  for (const c of cells()) {
    const line = (units: number, weight: number) =>
      `<line x1="${c.x}" x2="${c.x + CELL.width}" y1="${c.y + BASELINE - units / UNITS}" y2="${c.y + BASELINE - units / UNITS}" stroke="${GUIDE}" stroke-width="${weight}"/>`
    parts.push(
      `<rect x="${c.x}" y="${c.y}" width="${CELL.width}" height="${CELL.height}" fill="none" stroke="${GUIDE}" stroke-width="1"/>`,
      line(ASCENDER, 1),
      line(X_HEIGHT, 1),
      line(0, 2.2),
      line(DESCENDER, 1),
      `<text x="${c.x + 10}" y="${c.y + 24}" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#c3cad6">${c.char}</text>`,
    )
  }
  parts.push('</svg>')
  return parts.join('')
}

type Matrix3 = [number, number, number, number, number, number, number, number, number]

/**
 * The projective transform taking four points to four others. Eight unknowns,
 * eight equations, solved by Gaussian elimination with partial pivoting.
 */
export function homography(from: Point[], to: Point[]): Matrix3 {
  const a: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!
    const { x: u, y: v } = to[i]!
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r
    ;[a[col], a[pivot]] = [a[pivot]!, a[col]!]
    const p = a[col]![col]!
    if (Math.abs(p) < 1e-12) throw new Error('registration marks are degenerate')
    for (let c = col; c < 9; c++) a[col]![c]! /= p
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = a[r]![col]!
      if (f) for (let c = col; c < 9; c++) a[r]![c]! -= f * a[col]![c]!
    }
  }
  return [a[0]![8]!, a[1]![8]!, a[2]![8]!, a[3]![8]!, a[4]![8]!, a[5]![8]!, a[6]![8]!, a[7]![8]!, 1]
}

export function project(h: Matrix3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8]
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }
}

/**
 * Finds the four registration squares in a photograph.
 *
 * Candidates are dark blobs that are roughly square and mostly filled, which
 * rules out handwriting. Of those, the one nearest each corner of the frame
 * is taken. The page has to be roughly upright in the photo; it does not have
 * to be flat-on.
 */
export function findMarks(photo: Gray): Point[] | null {
  const factor = Math.max(1, Math.floor(Math.max(photo.width, photo.height) / 1100))
  const small = downscale(photo, factor)
  const mask = inkMask(small, otsu(small))
  const total = small.width * small.height
  const candidates = components(mask, small.width, small.height).filter((c) => {
    const w = c.maxX - c.minX + 1
    const h = c.maxY - c.minY + 1
    const aspect = w / h
    return c.area > total * 0.00015 && c.area < total * 0.02 && aspect > 0.45 && aspect < 2.2 && c.area / (w * h) > 0.62
  })
  if (candidates.length < 4) return null

  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: small.width, y: 0 },
    { x: small.width, y: small.height },
    { x: 0, y: small.height },
  ]
  const picked = corners.map((corner) =>
    candidates.reduce((best, c) => (Math.hypot(c.cx - corner.x, c.cy - corner.y) < Math.hypot(best.cx - corner.x, best.cy - corner.y) ? c : best)),
  )
  if (new Set(picked).size < 4) return null
  return picked.map((c) => ({ x: (c.cx + 0.5) * factor, y: (c.cy + 0.5) * factor }))
}

export interface Extraction {
  samples: GlyphSample[]
  /** Per-stroke pen widths along the path, in font units. */
  widthProfiles: number[][]
  /** Median pen width in font units. */
  penWidth: number
  /** Where the registration squares were found, in photo pixels. */
  marks: Point[]
}

/** Pixels per sheet unit in the rectified image. Two keeps a ballpoint a few pixels wide. */
const RECTIFIED = 2

/**
 * Photograph of a filled-in template in, strokes out.
 *
 * Each cell is pulled out of the photo through the homography, thresholded
 * against its own paper white (so a shadow across the page does not matter),
 * thinned to a centreline and traced.
 */
export function extractFromPhoto(photo: Gray): Extraction | null {
  const marks = findMarks(photo)
  if (!marks) return null
  const toPhoto = homography(MARKS, marks)

  const samples: GlyphSample[] = []
  const widthProfiles: number[][] = []
  const allWidths: number[] = []
  const inset = 5

  for (const cell of cells()) {
    const w = (CELL.width - inset * 2) * RECTIFIED
    const h = (CELL.height - inset * 2) * RECTIFIED
    const patch = gray(w, h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = project(toPhoto, { x: cell.x + inset + x / RECTIFIED, y: cell.y + inset + y / RECTIFIED })
        patch.data[y * w + x] = sample(photo, p.x, p.y)
      }

    // Paper white for this cell is a high percentile of its own pixels.
    const hist = new Uint32Array(256)
    for (const v of patch.data) hist[v]!++
    let seen = 0
    let white = 255
    for (let v = 255; v >= 0; v--) {
      seen += hist[v]!
      if (seen >= patch.data.length * 0.15) { white = v; break }
    }
    // The pale guides and the grey prompt letter sit above 0.75 of white.
    const mask = inkMask(patch, white * 0.6)
    for (const c of components(mask, w, h)) {
      if (c.area >= 14) continue
      for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) mask[y * w + x] = 0
    }

    const traced = traceSkeleton(thin(mask, w, h), distanceToPaper(mask, w, h), w, h)
    const toUnits = (p: Point): Point => ({
      x: (p.x / RECTIFIED + inset) * UNITS,
      y: (BASELINE - (p.y / RECTIFIED + inset)) * UNITS,
    })
    const strokes = []
    for (const t of traced) {
      const pts = t.points.map(toUnits)
      const length = pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) : 0), 0)
      if (length < 25 && !t.closed) continue
      strokes.push(simplify(pts, 2.5))
      const widths = t.widths.map((px) => (px / RECTIFIED) * UNITS)
      widthProfiles.push(widths)
      allWidths.push(...widths)
    }
    samples.push({ char: cell.char, strokes })
  }

  allWidths.sort((a, b) => a - b)
  return { samples, widthProfiles, penWidth: allWidths.length ? allWidths[allWidths.length >> 1]! : 56, marks }
}

/** Renders a filled-in template as a greyscale image, for tests and the demo. */
export function renderSheet(samples: GlyphSample[], penWidth: number, pixelsPerUnit = 2): Gray {
  const k = pixelsPerUnit
  const img = gray(SHEET.width * k, SHEET.height * k, 250)
  const rect = (x: number, y: number, w: number, h: number, v: number) => {
    for (let j = Math.round(y * k); j < Math.round((y + h) * k); j++)
      for (let i = Math.round(x * k); i < Math.round((x + w) * k); i++) img.data[j * img.width + i] = v
  }
  for (const m of MARKS) rect(m.x - MARK / 2, m.y - MARK / 2, MARK, MARK, 12)
  const bySample = new Map(samples.map((s) => [s.char, s]))
  for (const cell of cells()) {
    for (const units of [ASCENDER, X_HEIGHT, 0, DESCENDER]) rect(cell.x, cell.y + BASELINE - units / UNITS - 0.5, CELL.width, units === 0 ? 2 : 1, 212)
    rect(cell.x, cell.y, CELL.width, 1, 212)
    rect(cell.x, cell.y + CELL.height - 1, CELL.width, 1, 212)
    rect(cell.x, cell.y, 1, CELL.height, 212)
    rect(cell.x + CELL.width - 1, cell.y, 1, CELL.height, 212)
    const s = bySample.get(cell.char)
    if (!s) continue
    for (const stroke of s.strokes) {
      const r = ((penWidth / UNITS) * k) / 2
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1]!
        const b = stroke[i]!
        const ax = (cell.x + a.x / UNITS) * k, ay = (cell.y + BASELINE - a.y / UNITS) * k
        const bx = (cell.x + b.x / UNITS) * k, by = (cell.y + BASELINE - b.y / UNITS) * k
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2))
        for (let t = 0; t <= steps; t++) {
          const cx = ax + ((bx - ax) * t) / steps
          const cy = ay + ((by - ay) * t) / steps
          for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(img.height - 1, Math.ceil(cy + r)); y++)
            for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(img.width - 1, Math.ceil(cx + r)); x++)
              if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.data[y * img.width + x] = 28
        }
      }
    }
  }
  return img
}

/**
 * Turns a flat sheet into something like a phone photo: perspective, a
 * lighting gradient, and sensor noise. `corners` says where the four sheet
 * corners land in the output frame.
 */
export function photograph(sheet: Gray, width: number, height: number, corners: Point[], noise = 6): Gray {
  const sheetCorners: Point[] = [
    { x: 0, y: 0 },
    { x: sheet.width, y: 0 },
    { x: sheet.width, y: sheet.height },
    { x: 0, y: sheet.height },
  ]
  const toSheet = homography(corners, sheetCorners)
  const out = gray(width, height, 70)
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = project(toSheet, { x, y })
      if (p.x < 0 || p.y < 0 || p.x >= sheet.width - 1 || p.y >= sheet.height - 1) continue
      // Brighter toward the top left, the way a desk lamp falls off.
      const light = 1 - 0.28 * (x / width) - 0.14 * (y / height)
      out.data[y * width + x] = Math.max(0, Math.min(255, sample(sheet, p.x, p.y) * light + random() * noise * 2))
    }
  return out
}
