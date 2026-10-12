/**
 * Drives the real app in a headless browser and records docs/demo.gif.
 * Along the way it saves the font the browser exported, so that file can be
 * validated like any other, and the three specimen posters.
 *
 *   npm run dev &        (or npm run preview after a build)
 *   npm run demo
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { synthSamples } from '../src/core/synth'
import type { StyleProfile } from '../src/core/types'
import { VIEW, VIEW_WIDTH } from '../src/ui/view'
import type { Frame } from './lib/gif'
import { encodeGif } from './lib/gif'
import { skeleton } from './lib/skeleton-node'

const BASE = process.env.DEMO_URL ?? 'http://localhost:4102'
const WIDTH = 900
const HEIGHT = 600

function cachedChromium(): string | undefined {
  const cache = path.join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const bin = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
    if (existsSync(bin)) return bin
  }
  return undefined
}

// A hand that is none of the built-in demo hands, so the measurement on
// screen is of strokes that arrived through the pointer and nothing else.
const HAND: StyleProfile = { slant: 9, strokeWidth: 58, xHeightRatio: 0.68, roundness: 0.9, wobble: 0.035, widthScale: 1.02, terminal: 'round' }

async function main() {
  const docs = path.join(process.cwd(), 'docs')
  const out = path.join(process.cwd(), 'dist-font')
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: cachedChromium() })
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, acceptDownloads: true })
  const page = await context.newPage()
  const frames: Frame[] = []

  const shoot = async (delay: number) => {
    const png = await page.screenshot({ type: 'png' })
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    frames.push({ rgba: new Uint8Array(data), delay })
  }
  const hold = async (ms: number, every = 220) => {
    for (let t = 0; t < ms; t += every) {
      await shoot(every)
      await page.waitForTimeout(40)
    }
  }
  const scrollTo = async (selector: string, offset = 70) => {
    await page.evaluate(([sel, off]) => {
      const el = document.querySelector(sel as string)!
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (off as number) })
    }, [selector, offset])
    await page.waitForTimeout(150)
  }
  const save = async (testId: string, file: string) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`[data-testid="${testId}"]`)])
    await download.saveAs(file)
  }

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await hold(1300)

  // Scene 1: write the ten letters with a real pointer.
  await scrollTo('.cells', 150)
  const written = synthSamples(skeleton, HAND, { scale: 0.95, baseline: 8, jitter: 3 })
  for (const sample of written) {
    await drawLetter(page, sample.char, sample.strokes.map((s) => s.map((p) => ({ x: p.x + 150, y: p.y }))), shoot)
    await shoot(120)
  }
  await hold(700)

  // Scene 2: what it measured.
  await scrollTo('.sliders', 130)
  await hold(2000)
  const measured = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('[data-testid^="value-"]')].map((el) => [el.getAttribute('data-testid')!.slice(6), el.textContent])),
  )
  await page.screenshot({ path: path.join(docs, 'screen-measure.png') })

  // Scene 3: type in the new font.
  await scrollTo('.preview', 110)
  await page.fill('[data-testid="preview"]', '')
  await page.click('[data-testid="preview"]')
  for (const char of 'Dear future me, this font is my handwriting. All 90 glyphs of it!') {
    await page.keyboard.type(char)
    await shoot(55)
  }
  await hold(1400)
  await page.screenshot({ path: path.join(docs, 'screen-preview.png') })

  // Scene 4: redo one letter and watch only that letter change.
  await scrollTo('.cells', 150)
  await page.click('.cell[data-char="e"] .redo')
  await hold(500)
  const taller = written.find((s) => s.char === 'e')!.strokes.map((s) => s.map((p) => ({ x: p.x * 1.25 + 130, y: p.y * 1.12 })))
  await drawLetter(page, 'e', taller, shoot)
  await hold(700)
  await page.screenshot({ path: path.join(docs, 'screen-draw.png') })
  await scrollTo('.preview', 110)
  await hold(1500)

  // Scene 5: export. Save what the browser actually produced.
  await scrollTo('.export', 330)
  await hold(900)
  await save('download-ttf', path.join(out, 'browser-export.ttf'))
  await save('download-woff2', path.join(out, 'browser-export.woff2'))
  for (const id of ['poster-1', 'poster-2', 'poster-3']) await save(id, path.join(docs, `${id}.png`))
  const stats = await page.textContent('[data-testid="stats"]')
  await hold(900)

  // Scene 6: the same thing from a photographed sheet.
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await scrollTo('.cells', 190)
  await hold(500)
  await page.setInputFiles('[data-testid="photo-input"]', path.join(docs, 'sample-photo.png'))
  await page.waitForSelector('.notice')
  await page.waitForTimeout(600)
  const notice = await page.textContent('.notice')
  await hold(2200)
  await page.screenshot({ path: path.join(docs, 'screen-import.png') })

  // A phone-width pass, for a still only.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(docs, 'screen-phone.png') })

  await browser.close()
  const gif = encodeGif(frames, WIDTH, HEIGHT)
  writeFileSync(path.join(docs, 'demo.gif'), gif)
  console.log(JSON.stringify({ frames: frames.length, gifMB: +(gif.length / 1024 / 1024).toFixed(2), truth: HAND, measured, stats, notice }, null, 2))
}

/** Moves the mouse through a letter's strokes inside its cell, a few points per frame. */
async function drawLetter(page: Page, char: string, strokes: Array<Array<{ x: number; y: number }>>, shoot: (delay: number) => Promise<void>) {
  const box = (await page.locator(`.cell[data-char="${char}"] canvas`).boundingBox())!
  const k = box.width / VIEW_WIDTH
  const at = (p: { x: number; y: number }) => ({ x: box.x + (p.x - VIEW.minX) * k, y: box.y + (VIEW.maxY - p.y) * k })
  for (const stroke of strokes) {
    const start = at(stroke[0]!)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let i = 1; i < stroke.length; i++) {
      const p = at(stroke[i]!)
      await page.mouse.move(p.x, p.y)
      if (i % 9 === 0) await shoot(45)
    }
    await page.mouse.up()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
