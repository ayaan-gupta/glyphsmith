/**
 * Builds a font from one of the invented demo hands, without a browser.
 *
 *   npm run font -- --hand Hurried --out dist-font
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildFont, calibrate } from '../src/core/build'
import { DEMO_HANDS, synthSamples } from '../src/core/synth'
import { skeleton } from './lib/skeleton-node'

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

async function main() {
  const hand = DEMO_HANDS.find((h) => h.name.toLowerCase() === flag('hand', 'Hurried').toLowerCase()) ?? DEMO_HANDS[0]!
  const out = path.resolve(flag('out', 'dist-font'))
  const family = flag('name', 'Glyphsmith Demo')
  mkdirSync(out, { recursive: true })

  // Written a little small and a little high, the way people actually use guides.
  const samples = synthSamples(skeleton, hand.profile, { scale: 0.9, baseline: 12, jitter: 2 })
  const cal = calibrate(samples, skeleton, hand.profile.strokeWidth * 0.9)
  const font = await buildFont(samples, skeleton, cal, family)

  const file = family.replace(/\s+/g, '-')
  writeFileSync(path.join(out, `${file}.ttf`), font.ttf)
  writeFileSync(path.join(out, `${file}.woff2`), font.woff2)
  const sources = font.glyphs.reduce<Record<string, number>>((n, g) => ({ ...n, [g.source]: (n[g.source] ?? 0) + 1 }), {})
  console.log(JSON.stringify({
    hand: hand.name,
    measured: cal.profile,
    glyphs: font.glyphs.length,
    sources,
    points: font.glyphs.reduce((n, g) => n + g.contours.reduce((m, c) => m + c.length, 0), 0),
    ttfBytes: font.ttf.length,
    woff2Bytes: font.woff2.length,
    ms: Math.round(font.ms),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
