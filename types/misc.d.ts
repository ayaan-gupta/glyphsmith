declare module '*.jhf?raw' {
  const text: string
  export default text
}

declare module 'gifenc' {
  export type Palette = number[][]
  export interface FrameOptions {
    palette?: Palette
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
    repeat?: number
  }
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array
  }
  export function GIFEncoder(): Encoder
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: string }): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array
}

declare module 'opentype.js' {
  export interface Glyph {
    name: string | null
    unicode: number | undefined
    index: number
    advanceWidth: number
    path: { commands: Array<{ type: string }> }
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number }
  }
  export interface Font {
    unitsPerEm: number
    ascender: number
    descender: number
    numGlyphs: number
    names: Record<string, Record<string, string>>
    glyphs: { length: number; get(index: number): Glyph }
    charToGlyph(char: string): Glyph
    charToGlyphIndex(char: string): number
    getAdvanceWidth(text: string, fontSize: number): number
  }
  export function parse(buffer: ArrayBuffer): Font
}
