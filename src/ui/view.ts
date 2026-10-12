import { ASCENDER, DESCENDER, X_HEIGHT } from '../core/types'

/** The window of font space each drawing cell shows. */
export const VIEW = { minX: -80, maxX: 1000, minY: -330, maxY: 860 }
export const VIEW_WIDTH = VIEW.maxX - VIEW.minX
export const VIEW_HEIGHT = VIEW.maxY - VIEW.minY

export const GUIDES: Array<{ y: number; label: string; strong?: boolean }> = [
  { y: ASCENDER, label: 'ascender' },
  { y: X_HEIGHT, label: 'x-height' },
  { y: 0, label: 'baseline', strong: true },
  { y: DESCENDER, label: 'descender' },
]

export const INK = '#1b3a73'
export const PAPER = '#faf6ec'
export const GUIDE = '#b9d3f0'

interface Rect { left: number; top: number; width: number }

/** Screen position to font units. The canvas can be any size; only its width matters. */
export function clientToFont(rect: Rect, clientX: number, clientY: number): { x: number; y: number } {
  const k = rect.width / VIEW_WIDTH
  return { x: VIEW.minX + (clientX - rect.left) / k, y: VIEW.maxY - (clientY - rect.top) / k }
}

export function fontToClient(rect: Rect, x: number, y: number): { x: number; y: number } {
  const k = rect.width / VIEW_WIDTH
  return { x: rect.left + (x - VIEW.minX) * k, y: rect.top + (VIEW.maxY - y) * k }
}
