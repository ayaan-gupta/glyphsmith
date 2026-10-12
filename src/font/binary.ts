/** A growable big-endian byte buffer. Fonts are big-endian throughout. */
export class Writer {
  private buf = new Uint8Array(1024)
  private view = new DataView(this.buf.buffer)
  length = 0

  private grow(extra: number): void {
    if (this.length + extra <= this.buf.length) return
    let size = this.buf.length
    while (size < this.length + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
    this.view = new DataView(next.buffer)
  }

  u8(v: number): this { this.grow(1); this.view.setUint8(this.length, v & 0xff); this.length += 1; return this }
  u16(v: number): this { this.grow(2); this.view.setUint16(this.length, v & 0xffff); this.length += 2; return this }
  i16(v: number): this { this.grow(2); this.view.setInt16(this.length, v); this.length += 2; return this }
  u32(v: number): this { this.grow(4); this.view.setUint32(this.length, v >>> 0); this.length += 4; return this }
  i32(v: number): this { this.grow(4); this.view.setInt32(this.length, v); this.length += 4; return this }

  tag(t: string): this {
    for (let i = 0; i < 4; i++) this.u8(t.charCodeAt(i))
    return this
  }

  bytes(data: Uint8Array): this {
    this.grow(data.length)
    this.buf.set(data, this.length)
    this.length += data.length
    return this
  }

  /** Pads with zeros to a multiple of `n` bytes. */
  pad(n: number): this {
    while (this.length % n) this.u8(0)
    return this
  }

  /** Overwrites a u32 already written, for fields only known at the end. */
  patchU32(offset: number, v: number): void {
    this.view.setUint32(offset, v >>> 0)
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

/** The sfnt table checksum: big-endian u32 words summed modulo 2^32, zero padded. */
export function checksum(data: Uint8Array): number {
  let sum = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const whole = data.length & ~3
  for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(i)) >>> 0
  if (whole < data.length) {
    let last = 0
    for (let i = whole; i < whole + 4; i++) last = (last << 8) | (i < data.length ? data[i]! : 0)
    sum = (sum + (last >>> 0)) >>> 0
  }
  return sum
}

export const padded = (n: number): number => (n + 3) & ~3
