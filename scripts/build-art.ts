/**
 * Writes the files that are generated from code and not drawn in the browser:
 * the printable template, and a synthetic "phone photo" of a filled-in
 * template that the demo and the README use.
 *
 *   npm run art
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { synthSamples } from '../src/core/synth'
import type { StyleProfile } from '../src/core/types'
import { photograph, renderSheet, templateSvg } from '../src/raster/template'
import { skeleton } from './lib/skeleton-node'

async function main() {
  const interim = path.join(process.cwd(), 'assets', 'interim')
  const docs = path.join(process.cwd(), 'docs')
  mkdirSync(interim, { recursive: true })
  mkdirSync(docs, { recursive: true })

  writeFileSync(path.join(interim, 'template.svg'), templateSvg())

  const hand: StyleProfile = { slant: 11, strokeWidth: 46, xHeightRatio: 0.64, roundness: 0.85, wobble: 0.03, widthScale: 0.95, terminal: 'round' }
  const written = synthSamples(skeleton, hand, { jitter: 2 }).map((s) => ({
    char: s.char,
    strokes: s.strokes.map((st) => st.map((p) => ({ x: p.x + 520, y: p.y }))),
  }))
  const sheet = renderSheet(written, hand.strokeWidth)
  const photo = photograph(sheet, 1500, 2000, [{ x: 130, y: 90 }, { x: 1390, y: 150 }, { x: 1440, y: 1900 }, { x: 60, y: 1830 }])
  await sharp(Buffer.from(photo.data), { raw: { width: photo.width, height: photo.height, channels: 1 } })
    .png()
    .toFile(path.join(docs, 'sample-photo.png'))
  console.log('wrote assets/interim/template.svg and docs/sample-photo.png')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
