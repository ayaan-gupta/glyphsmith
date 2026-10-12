import type { Point, Stroke } from '../core/types'

/** An 8-bit greyscale image. 0 is black ink, 255 is white paper. */
export interface Gray {
  width: number
  height: number
  data: Uint8Array
}

export function gray(width: number, height: number, fill = 255): Gray {
  return { width, height, data: new Uint8Array(width * height).fill(fill) }
}

/** Rec. 601 luma from RGBA pixels, which is what a canvas hands over. */
export function fromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const out = gray(width, height)
  for (let i = 0, p = 0; i < out.data.length; i++, p += 4) {
    out.data[i] = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000
  }
  return out
}

export function fillRect(img: Gray, x: number, y: number, w: number, h: number, value: number): void {
  for (let j = Math.max(0, Math.round(y)); j < Math.min(img.height, Math.round(y + h)); j++)
    for (let i = Math.max(0, Math.round(x)); i < Math.min(img.width, Math.round(x + w)); i++) img.data[j * img.width + i] = value
}

export function drawDisc(img: Gray, cx: number, cy: number, r: number, value: number): void {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(img.height - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(img.width - 1, Math.ceil(cx + r)); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.data[y * img.width + x] = value
}

/** Draws a pen path as overlapping discs, half a pixel apart. Coordinates are in pixels. */
export function drawStroke(img: Gray, stroke: Stroke, width: number, value = 0): void {
  if (stroke.length === 1) drawDisc(img, stroke[0]!.x, stroke[0]!.y, width / 2, value)
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]!
    const b = stroke[i]!
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2))
    for (let s = 0; s <= steps; s++) drawDisc(img, a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps, width / 2, value)
  }
}

/** Otsu's threshold: the grey level that best splits the histogram into two classes. */
export function otsu(img: Gray): number {
  const hist = new Float64Array(256)
  for (const v of img.data) hist[v]!++
  const total = img.data.length
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!
  let sumBelow = 0
  let countBelow = 0
  let best = 0
  let first = 127
  let last = 127
  for (let t = 0; t < 256; t++) {
    countBelow += hist[t]!
    if (countBelow === 0) continue
    const countAbove = total - countBelow
    if (countAbove === 0) break
    sumBelow += t * hist[t]!
    const between = countBelow * countAbove * (sumBelow / countBelow - (sumAll - sumBelow) / countAbove) ** 2
    if (between > best * (1 + 1e-9)) {
      best = between
      first = t
      last = t
    } else if (between >= best * (1 - 1e-9)) {
      last = t
    }
  }
  // On a clean two-tone image every level between the tones scores the same.
  // Taking the first would put the threshold on the ink itself, so take the
  // middle of the plateau.
  return Math.ceil((first + last) / 2) + 1
}

/** 1 where the image is darker than the threshold. */
export function inkMask(img: Gray, threshold: number): Uint8Array {
  const mask = new Uint8Array(img.data.length)
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i]! < threshold ? 1 : 0
  return mask
}

/** Shrinks by an integer factor with box averaging. */
export function downscale(img: Gray, factor: number): Gray {
  if (factor <= 1) return img
  const w = Math.floor(img.width / factor)
  const h = Math.floor(img.height / factor)
  const out = gray(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) sum += img.data[(y * factor + j) * img.width + x * factor + i]!
      out.data[y * w + x] = sum / (factor * factor)
    }
  return out
}

/** Bilinear sample, clamped at the edges. */
export function sample(img: Gray, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)))
  const x1 = Math.min(img.width - 1, x0 + 1)
  const y1 = Math.min(img.height - 1, y0 + 1)
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  const d = img.data
  const top = d[y0 * img.width + x0]! * (1 - fx) + d[y0 * img.width + x1]! * fx
  const bottom = d[y1 * img.width + x0]! * (1 - fx) + d[y1 * img.width + x1]! * fx
  return top * (1 - fy) + bottom * fy
}

export interface Component {
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  cx: number
  cy: number
}

/** Connected regions of a mask, by flood fill with an explicit stack. */
export function components(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length)
  const out: Component[] = []
  const stack: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    const c: Component = { area: 0, minX: width, minY: height, maxX: 0, maxY: 0, cx: 0, cy: 0 }
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      c.area++
      c.cx += x
      c.cy += y
      if (x < c.minX) c.minX = x
      if (x > c.maxX) c.maxX = x
      if (y < c.minY) c.minY = y
      if (y > c.maxY) c.maxY = y
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1) }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1) }
      if (y > 0 && mask[i - width] && !seen[i - width]) { seen[i - width] = 1; stack.push(i - width) }
      if (y < height - 1 && mask[i + width] && !seen[i + width]) { seen[i + width] = 1; stack.push(i + width) }
    }
    c.cx /= c.area
    c.cy /= c.area
    out.push(c)
  }
  return out
}

export type { Point }
