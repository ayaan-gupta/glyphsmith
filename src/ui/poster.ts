import type { StyleProfile } from '../core/types'
import { generatedAsset } from './assets'
import { INK, PAPER } from './view'

export const POSTER = { width: 1600, height: 2100 }

export interface PosterStyle {
  id: string
  name: string
  /** Text colour that reads on this background. */
  ink: string
  muted: string
  paint: (ctx: CanvasRenderingContext2D) => void
}

function grain(ctx: CanvasRenderingContext2D, colour: string, count: number, seed: number): void {
  let s = seed
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  ctx.fillStyle = colour
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.03 + rand() * 0.07
    ctx.fillRect(rand() * POSTER.width, rand() * POSTER.height, 1 + rand() * 2.2, 1 + rand() * 2.2)
  }
  ctx.globalAlpha = 1
}

/**
 * Three specimen backgrounds, drawn on a canvas. These are interim art: a
 * delivered image at assets/generated/poster-1, -2 or -3 is used in place of
 * the matching one here.
 */
export const POSTER_STYLES: PosterStyle[] = [
  {
    id: 'poster-1',
    name: 'Ledger',
    ink: INK,
    muted: '#7d8aa3',
    paint(ctx) {
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, POSTER.width, POSTER.height)
      ctx.strokeStyle = '#cfe0f4'
      ctx.lineWidth = 2
      for (let y = 180; y < POSTER.height - 80; y += 64) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(POSTER.width, y)
        ctx.stroke()
      }
      ctx.strokeStyle = '#e8b4a2'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(150, 0)
      ctx.lineTo(150, POSTER.height)
      ctx.stroke()
      // Three punched holes down the margin.
      ctx.fillStyle = '#ece4d2'
      for (const y of [330, 1050, 1770]) {
        ctx.beginPath()
        ctx.arc(74, y, 26, 0, Math.PI * 2)
        ctx.fill()
      }
      grain(ctx, '#6b5a3c', 9000, 3)
    },
  },
  {
    id: 'poster-2',
    name: 'Blueprint',
    ink: '#f4f0e4',
    muted: '#9fb6dd',
    paint(ctx) {
      ctx.fillStyle = '#17336a'
      ctx.fillRect(0, 0, POSTER.width, POSTER.height)
      for (let i = 0; i <= POSTER.width; i += 40) {
        ctx.strokeStyle = i % 200 === 0 ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.07)'
        ctx.lineWidth = i % 200 === 0 ? 2 : 1
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, POSTER.height); ctx.stroke()
      }
      for (let j = 0; j <= POSTER.height; j += 40) {
        ctx.strokeStyle = j % 200 === 0 ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.07)'
        ctx.lineWidth = j % 200 === 0 ? 2 : 1
        ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(POSTER.width, j); ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 3
      ctx.strokeRect(60, 60, POSTER.width - 120, POSTER.height - 120)
      grain(ctx, '#ffffff', 7000, 11)
    },
  },
  {
    id: 'poster-3',
    name: 'Wash',
    ink: INK,
    muted: '#7d8aa3',
    paint(ctx) {
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, POSTER.width, POSTER.height)
      // An ink wash built from many faint overlapping discs, so its edge is
      // uneven the way a wet brush leaves it.
      let s = 29
      const rand = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0
        return s / 4294967296
      }
      ctx.fillStyle = '#8fb1e3'
      for (let i = 0; i < 260; i++) {
        const a = rand() * Math.PI * 2
        const d = Math.sqrt(rand()) * 330
        ctx.globalAlpha = 0.018 + rand() * 0.02
        ctx.beginPath()
        ctx.ellipse(1080 + Math.cos(a) * d * 1.25, 560 + Math.sin(a) * d, 120 + rand() * 170, 100 + rand() * 150, rand() * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      grain(ctx, '#6b5a3c', 9000, 5)
    },
  },
]

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Draws a type specimen in the generated font and returns it as a PNG blob. */
export async function renderPoster(style: PosterStyle, fontFamily: string, displayName: string, profile: StyleProfile): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = POSTER.width
  canvas.height = POSTER.height
  const ctx = canvas.getContext('2d')!

  const delivered = generatedAsset(style.id)
  if (delivered) ctx.drawImage(await loadImage(delivered), 0, 0, POSTER.width, POSTER.height)
  else style.paint(ctx)

  const left = 210
  const face = (size: number) => `${size}px "${fontFamily}"`
  const meta = (size: number) => `600 ${size}px -apple-system, "Helvetica Neue", Arial, sans-serif`
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = style.muted
  ctx.font = meta(26)
  ctx.fillText('TYPE SPECIMEN', left, 150)

  ctx.fillStyle = style.ink
  ctx.font = face(560)
  ctx.fillText('Aa', left - 14, 700)

  ctx.font = face(150)
  ctx.fillText(displayName, left, 930, POSTER.width - left - 120)

  ctx.font = face(88)
  const lines = [UPPER.slice(0, 13), UPPER.slice(13), UPPER.slice(0, 13).toLowerCase(), UPPER.slice(13).toLowerCase(), '0123456789', '.,;:!? ( ) [ ] { } & @ # $ % * + ='].map((l) => [...l].join(' '))
  lines.forEach((line, i) => ctx.fillText(line, left, 1090 + i * 118, POSTER.width - left - 110))

  ctx.font = face(104)
  ctx.fillText('Sphinx of black quartz,', left, 1850, POSTER.width - left - 110)
  ctx.fillText('judge my vow.', left, 1970, POSTER.width - left - 110)

  ctx.fillStyle = style.muted
  ctx.font = meta(24)
  const facts = `Ten letters drawn by hand, eighty derived.  Slant ${profile.slant.toFixed(0)} degrees, pen ${profile.strokeWidth.toFixed(0)}, x-height ${profile.xHeightRatio.toFixed(2)}.`
  ctx.fillText(facts, left, 2046)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode poster'))), 'image/png'))
}
