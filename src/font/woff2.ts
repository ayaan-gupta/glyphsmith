import { padded, Writer } from './binary'

export type Brotli = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>

/**
 * A valid Brotli stream that compresses nothing.
 *
 * Brotli allows "uncompressed meta-blocks": a three byte header followed by
 * the raw bytes. This is the fallback when no real compressor can be loaded,
 * so an export never fails outright. The file it yields is a correct WOFF2
 * that every browser accepts, just no smaller than the TTF.
 */
export function brotliStored(data: Uint8Array): Uint8Array {
  const out = new Writer()
  const BLOCK = 65536
  for (let offset = 0; offset < data.length; offset += BLOCK) {
    const chunk = data.subarray(offset, Math.min(data.length, offset + BLOCK))
    const first = offset === 0
    // Bits, least significant first: [WBITS = 0, first block only], ISLAST = 0,
    // MNIBBLES = 00 (four nibbles), MLEN - 1 in 16 bits, ISUNCOMPRESSED = 1.
    let bits = 0n
    let count = 0
    const push = (value: number, width: number) => {
      bits |= BigInt(value) << BigInt(count)
      count += width
    }
    if (first) push(0, 1)
    push(0, 1)
    push(0, 2)
    push(chunk.length - 1, 16)
    push(1, 1)
    for (let i = 0; i < 3; i++) out.u8(Number((bits >> BigInt(i * 8)) & 0xffn))
    out.bytes(chunk)
  }
  // A stream must open with WBITS even when there is no data to carry.
  if (data.length === 0) out.u8(0x06)
  else out.u8(0x03) // ISLAST = 1, ISLASTEMPTY = 1
  return out.done()
}

// The WOFF2 spec numbers the common table tags so each fits in six bits.
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
]

function uintBase128(w: Writer, value: number): void {
  const groups: number[] = []
  do {
    groups.unshift(value & 0x7f)
    value >>>= 7
  } while (value > 0)
  groups.forEach((g, i) => w.u8(i < groups.length - 1 ? g | 0x80 : g))
}

/**
 * Wraps sfnt tables in a WOFF2 container.
 *
 * WOFF2 normally rewrites `glyf` and `loca` into a denser form before
 * compressing. That transform is optional: transform version 3 means "stored
 * as is", and it keeps this encoder to one page. Brotli does the real work.
 */
export async function buildWoff2(tables: Map<string, Uint8Array>, brotli: Brotli = brotliStored): Promise<Uint8Array> {
  // glyf then loca at the end, the pairing decoders expect.
  const order = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'glyf', 'loca'].filter((t) => tables.has(t))
  for (const tag of tables.keys()) if (!order.includes(tag)) order.push(tag)

  const data = new Map(tables)
  // Bit 11 of head.flags records that the font went through a lossless
  // transform, which is how a decoder knows not to trust stored checksums.
  const head = new Uint8Array(data.get('head')!)
  const headView = new DataView(head.buffer)
  headView.setUint16(16, headView.getUint16(16) | 0x0800)
  headView.setUint32(8, 0)
  data.set('head', head)

  const directory = new Writer()
  const body = new Writer()
  let sfntSize = 12 + 16 * order.length
  for (const tag of order) {
    const table = data.get(tag)!
    const known = KNOWN_TAGS.indexOf(tag.padEnd(4, ' '))
    const transform = tag === 'glyf' || tag === 'loca' ? 3 : 0
    if (known >= 0) directory.u8((transform << 6) | known)
    else directory.u8((transform << 6) | 63).tag(tag.padEnd(4, ' '))
    uintBase128(directory, table.length)
    body.bytes(table)
    sfntSize += padded(table.length)
  }

  const compressed = await brotli(body.done())
  const dir = directory.done()
  const w = new Writer()
  w.tag('wOF2').u32(0x00010000)
  w.u32(padded(48 + dir.length + compressed.length))
  w.u16(order.length).u16(0)
  w.u32(sfntSize).u32(compressed.length)
  w.u16(1).u16(0)
  w.u32(0).u32(0).u32(0).u32(0).u32(0) // no metadata, no private data
  w.bytes(dir).bytes(compressed).pad(4)
  return w.done()
}

let cachedBrotli: Promise<Brotli> | null = null

/**
 * The best Brotli this runtime has: Node's built-in zlib, else the WASM build
 * in a browser, else stored blocks.
 */
export function loadBrotli(): Promise<Brotli> {
  cachedBrotli ??= (async (): Promise<Brotli> => {
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const zlib = await import(/* @vite-ignore */ 'node:zlib')
        return (data) =>
          new Uint8Array(
            zlib.brotliCompressSync(data, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT,
              },
            }),
          )
      } catch {
        // fall through
      }
    }
    try {
      const mod = await import('brotli-wasm')
      const brotli = await mod.default
      return (data) => brotli.compress(data, { quality: 11 })
    } catch {
      return brotliStored
    }
  })()
  return cachedBrotli
}
