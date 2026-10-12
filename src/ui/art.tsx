import { shapeSkeleton } from '../core/deform'
import { getSkeleton } from '../core/skeleton'
import type { Stroke, StyleProfile } from '../core/types'
import { generatedAsset } from './assets'
import { INK } from './view'

const HERO_HAND: StyleProfile = { slant: 13, strokeWidth: 40, xHeightRatio: 0.62, roundness: 0.85, wobble: 0.02, widthScale: 0.92, terminal: 'round' }

/** Sets a word in the skeleton font bent by a profile, as positioned strokes. */
export function wordStrokes(text: string, profile: StyleProfile): { strokes: Stroke[]; width: number } {
  const skeleton = getSkeleton()
  const strokes: Stroke[] = []
  let x = 0
  for (const char of text) {
    const glyph = skeleton.get(char)
    if (!glyph) { x += 260; continue }
    const shaped = shapeSkeleton(glyph, profile)
    for (const s of shaped.strokes) strokes.push(s.map((p) => ({ x: p.x + x, y: p.y })))
    x += shaped.advance
  }
  return { strokes, width: x }
}

const toPath = (stroke: Stroke, ox: number, oy: number, k: number): string =>
  stroke.map((p, i) => `${i ? 'L' : 'M'}${(ox + p.x * k).toFixed(1)} ${(oy - p.y * k).toFixed(1)}`).join('')

/**
 * The landing illustration: a nib, and the line coming out of it turning into
 * letters. Interim art, drawn here in code; a delivered hero image at
 * assets/generated/hero replaces it.
 */
export function Hero() {
  const delivered = generatedAsset('hero')
  if (delivered) return <img className="hero-art" src={delivered} alt="A pen whose line becomes letterforms" />

  const { strokes, width } = wordStrokes('handwriting', HERO_HAND)
  const ox = 232
  const oy = 226
  // Scale the word to fill the space to the right of the pen, whatever its length.
  const k = (780 - ox - 24) / width
  const first = strokes[0]![0]!
  const startX = ox + first.x * k
  const startY = oy - first.y * k
  return (
    <svg className="hero-art" viewBox="0 0 780 300" role="img" aria-label="A pen whose line becomes the word handwriting">
      <g fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
        {/* The pen, seen from the side and tilted the way a hand holds it. */}
        <g transform="translate(92 96) rotate(38)" strokeWidth="2.6">
          <path d="M-14 -150 L14 -150 L14 -34 L-14 -34 Z" />
          <path d="M-14 -34 L14 -34 L10 -14 L-10 -14 Z" />
          <path d="M-10 -14 L10 -14 L0 44 Z" />
          <path d="M0 -4 L0 40" strokeWidth="1.6" />
          <circle cx="0" cy="-2" r="2.6" />
          <path d="M-14 -120 L14 -120 M-14 -112 L14 -112" strokeWidth="1.6" />
        </g>
        {/* Ink leaving the nib, loose at first and then settling onto a baseline. */}
        <path
          d={`M66 132 C 40 190, 96 250, 150 214 S 200 150, ${(startX - 34).toFixed(1)} ${(startY + 8).toFixed(1)} S ${(startX - 8).toFixed(1)} ${(startY + 4).toFixed(1)}, ${startX.toFixed(1)} ${startY.toFixed(1)}`}
          strokeWidth={HERO_HAND.strokeWidth * k}
        />
        {strokes.map((s, i) => (
          <path key={i} d={toPath(s, ox, oy, k)} strokeWidth={HERO_HAND.strokeWidth * k} />
        ))}
        <path d={`M${ox - 8} ${oy + 30} L${ox + width * k + 12} ${oy + 30}`} stroke="#b9d3f0" strokeWidth="1.5" />
      </g>
    </svg>
  )
}

/** Paper grain as an inline SVG filter, used as a CSS background. No image file involved. */
export const PAPER_TEXTURE =
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' seed='7'/>` +
      `<feColorMatrix values='0 0 0 0 0.42  0 0 0 0 0.36  0 0 0 0 0.24  0 0 0 0.07 0'/></filter>` +
      `<rect width='240' height='240' filter='url(%23n)'/></svg>`,
  ).replace(/%2523/g, '%23')}")`
