/**
 * Loads an exported TTF and WOFF2 into headless Chromium through the FontFace
 * API. Chromium runs every web font through its OpenType Sanitizer first, and
 * a file with a malformed table is rejected, so a successful load is a fourth
 * independent opinion on the writer.
 *
 *   npx tsx scripts/check-browser.ts dist-font/Glyphsmith-Demo.ttf dist-font/Glyphsmith-Demo.woff2
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

function cachedChromium(): string | undefined {
  const cache = path.join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const bin = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
    if (existsSync(bin)) return bin
  }
  return undefined
}

async function main() {
  const files = process.argv.slice(2)
  const browser = await chromium.launch({ executablePath: cachedChromium() })
  const page = await browser.newPage()
  await page.setContent('<canvas id="c" width="900" height="120"></canvas>')
  const results = []
  for (const file of files) {
    const base64 = readFileSync(file).toString('base64')
    results.push(
      await page.evaluate(async ([name, data]) => {
        const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0))
        const family = `Check${Math.random().toString(36).slice(2)}`
        try {
          const face = await new FontFace(family, bytes.buffer).load()
          document.fonts.add(face)
          // Proof that it is really used: text set in it has a different width from the fallback.
          const ctx = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!
          ctx.font = `60px "${family}", monospace`
          const mine = ctx.measureText('handwriting 0123').width
          ctx.font = '60px monospace'
          const fallback = ctx.measureText('handwriting 0123').width
          return { file: name, loaded: true, status: face.status, rendersDifferently: Math.abs(mine - fallback) > 1 }
        } catch (error) {
          return { file: name, loaded: false, error: String(error) }
        }
      }, [path.basename(file), base64]),
    )
  }
  await browser.close()
  console.log(JSON.stringify(results, null, 2))
  if (results.some((r) => !r.loaded)) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
