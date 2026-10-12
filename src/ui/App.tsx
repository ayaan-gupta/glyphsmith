import { useEffect, useMemo, useRef, useState } from 'react'
import type { BuiltGlyph, FontFiles } from '../core/build'
import { buildFont, calibrate } from '../core/build'
import type { Calibration } from '../core/deform'
import { getSkeleton } from '../core/skeleton'
import { DEMO_HANDS, synthSamples } from '../core/synth'
import type { GlyphSample, Stroke, StyleProfile, Terminal } from '../core/types'
import { CHARSET, SAMPLE_CHARS } from '../core/types'
import { fromRgba } from '../raster/image'
import { extractFromPhoto, templateSvg } from '../raster/template'
import { Hero, PAPER_TEXTURE } from './art'
import { DrawCell } from './DrawCell'
import { POSTER_STYLES, renderPoster } from './poster'
import { VIEW } from './view'

type Samples = Record<string, Stroke[]>

const STORE = 'glyphsmith:v1'
const DEFAULT_TEXT = 'The quick brown fox jumps over the lazy dog, then asks: was that 100% necessary?'

interface Saved {
  samples: Samples
  penWidth: number
  calibration: Calibration | null
  name: string
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return JSON.parse(raw) as Saved
  } catch {
    // A corrupt or missing entry just means a fresh start.
  }
  return { samples: {}, penWidth: 56, calibration: null, name: 'My Hand' }
}

const toList = (samples: Samples): GlyphSample[] =>
  SAMPLE_CHARS.filter((c) => samples[c]?.length).map((char) => ({ char, strokes: samples[char]! }))

function download(data: Uint8Array | Blob | string, filename: string, type: string): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const SLIDERS: Array<{ key: keyof StyleProfile; label: string; min: number; max: number; step: number; unit: string; hint: string }> = [
  { key: 'slant', label: 'Slant', min: -30, max: 35, step: 0.5, unit: '°', hint: 'most common direction of your upright strokes' },
  { key: 'strokeWidth', label: 'Pen width', min: 16, max: 140, step: 1, unit: '', hint: 'in font units, scaled with your letters' },
  { key: 'xHeightRatio', label: 'x-height', min: 0.4, max: 0.9, step: 0.01, unit: '', hint: 'height of an "o" over height of an "l"' },
  { key: 'roundness', label: 'Roundness', min: 0, max: 1, step: 0.01, unit: '', hint: 'superellipse fitted to your bowls' },
  { key: 'wobble', label: 'Wobble', min: 0, max: 0.2, step: 0.005, unit: '', hint: 'how far letters stray from the baseline' },
  { key: 'widthScale', label: 'Width', min: 0.55, max: 1.6, step: 0.01, unit: '', hint: 'against the skeleton, with the lean removed' },
]

export function App() {
  const skeleton = useMemo(() => getSkeleton(), [])
  const initial = useMemo(load, [])
  const [samples, setSamples] = useState<Samples>(initial.samples)
  const [penWidth, setPenWidth] = useState(initial.penWidth)
  const [locked, setLocked] = useState<Calibration | null>(initial.calibration)
  const [name, setName] = useState(initial.name)
  const [text, setText] = useState(DEFAULT_TEXT)
  const [size, setSize] = useState(56)
  const [font, setFont] = useState<(FontFiles & { family: string }) | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const previous = useRef<FontFace | null>(null)

  const list = useMemo(() => toList(samples), [samples])
  const drawn = list.length

  // Until all ten letters exist the measurement follows the drawing live.
  // The moment the tenth lands it is frozen, and from then on redrawing a
  // letter changes that letter and nothing else.
  const provisional = useMemo(() => calibrate(list, skeleton, penWidth), [list, skeleton, penWidth])
  const calibration = locked ?? provisional
  useEffect(() => {
    if (!locked && drawn === SAMPLE_CHARS.length) setLocked(provisional)
  }, [locked, drawn, provisional])

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify({ samples, penWidth, calibration: locked, name } satisfies Saved))
  }, [samples, penWidth, locked, name])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const files = await buildFont(list, skeleton, calibration, name || 'My Hand')
      if (cancelled) return
      const family = `GlyphsmithPreview${++generation.current}`
      const face = new FontFace(family, files.ttf.buffer.slice(0) as ArrayBuffer)
      await face.load()
      if (cancelled) return
      document.fonts.add(face)
      if (previous.current) document.fonts.delete(previous.current)
      previous.current = face
      setFont({ ...files, family })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [list, skeleton, calibration, name])

  const setProfile = (patch: Partial<StyleProfile>) =>
    setLocked({ ...calibration, profile: { ...calibration.profile, ...patch } })

  const useDemoHand = (index: number) => {
    const hand = DEMO_HANDS[index]!
    const written = synthSamples(skeleton, hand.profile, { scale: 0.92, baseline: 10, jitter: 2 })
    const next: Samples = {}
    for (const s of written) next[s.char] = s.strokes.map((st) => st.map((p) => ({ x: p.x + 120, y: p.y })))
    const width = hand.profile.strokeWidth * 0.92
    setSamples(next)
    setPenWidth(Math.round(width))
    setLocked(calibrate(toList(next), skeleton, width))
    setName(`${hand.name} Hand`)
    setNotice(null)
  }

  const importPhoto = async (file: File) => {
    setNotice('Reading the photo')
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 2600 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const result = extractFromPhoto(fromRgba(pixels.data, canvas.width, canvas.height))
      if (!result) {
        setNotice('Could not find the four black corner squares. Make sure the whole page is in the frame and roughly upright.')
        return
      }
      const next: Samples = {}
      for (const s of result.samples) {
        if (!s.strokes.length) continue
        // A template cell is far wider than a drawing cell, and people write
        // wherever they like in it. Centre each letter so it is visible here.
        const xs = s.strokes.flat().map((p) => p.x)
        const shift = (VIEW.minX + VIEW.maxX) / 2 - (Math.min(...xs) + Math.max(...xs)) / 2
        next[s.char] = s.strokes.map((st) => st.map((p) => ({ x: p.x + shift, y: p.y })))
      }
      const found = Object.keys(next).length
      setSamples(next)
      setPenWidth(Math.round(result.penWidth))
      setLocked(found === SAMPLE_CHARS.length ? calibrate(toList(next), skeleton, result.penWidth) : null)
      setNotice(found === SAMPLE_CHARS.length ? `Read all ten letters from the photo.` : `Read ${found} of 10 letters. Draw the rest below.`)
    } catch {
      setNotice('That file could not be read as an image.')
    }
  }

  const fileBase = (name || 'My Hand').trim().replace(/\s+/g, '-')
  const bySource = (source: BuiltGlyph['source']) => font?.glyphs.filter((g) => g.source === source).length ?? 0
  const glyphSource = useMemo(() => new Map(font?.glyphs.map((g) => [g.char, g.source]) ?? []), [font])

  return (
    <div className="page" style={{ backgroundImage: PAPER_TEXTURE }}>
      <header className="masthead">
        <div>
          <p className="eyebrow">Glyphsmith</p>
          <h1>Ten letters in. Your whole handwriting out.</h1>
          <p className="lede">
            Write a, e, o, t, n, r, s, h, l and d. Glyphsmith measures how you write them and
            bends a plain single-line alphabet until it leans, loops and wobbles the way you do.
            Out comes a font you can install.
          </p>
          <p className="private">Runs entirely in this tab. Your handwriting is never uploaded.</p>
        </div>
        <Hero />
      </header>

      <section>
        <div className="section-head">
          <h2><span>1</span> Write ten letters</h2>
          <div className="tools">
            <label className="inline">
              Pen
              <input type="range" min={20} max={130} value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} aria-label="Pen width" />
            </label>
            <button type="button" onClick={() => download(templateSvg(), 'glyphsmith-template.svg', 'image/svg+xml')}>Print a template</button>
            <label className="button">
              Import a photo
              <input type="file" accept="image/*" hidden data-testid="photo-input" onChange={(e) => e.target.files?.[0] && importPhoto(e.target.files[0])} />
            </label>
          </div>
        </div>
        <p className="sub">
          Sit each letter on the heavier line. No pen handy? Borrow an invented hand:{' '}
          {DEMO_HANDS.map((hand, i) => (
            <button key={hand.name} type="button" className="link" title={hand.blurb} data-testid={`hand-${hand.name}`} onClick={() => useDemoHand(i)}>
              {hand.name}
            </button>
          ))}
        </p>
        {notice && <p className="notice" role="status">{notice}</p>}
        <div className="cells">
          {SAMPLE_CHARS.map((char) => (
            <DrawCell key={char} char={char} strokes={samples[char] ?? []} penWidth={penWidth} onChange={(strokes) => setSamples((s) => ({ ...s, [char]: strokes }))} />
          ))}
        </div>
        <div className="row-end">
          <span className="count">{drawn} of 10 drawn</span>
          <button type="button" className="link" onClick={() => { setSamples({}); setLocked(null); setNotice(null) }}>Clear everything</button>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2><span>2</span> What it measured</h2>
          <div className="tools">
            <span className={locked ? 'pill locked' : 'pill'}>{locked ? 'Locked' : drawn ? 'Following your pen' : 'Defaults'}</span>
            <button type="button" disabled={!drawn} data-testid="remeasure" onClick={() => setLocked(calibrate(list, skeleton, penWidth))}>Re-measure</button>
          </div>
        </div>
        <p className="sub">
          Six numbers and one choice describe the hand. They freeze once all ten letters are in, so
          redrawing one letter changes that letter and leaves the other 89 glyphs alone. Drag any of
          them if you disagree with the machine.
        </p>
        <div className="sliders">
          {SLIDERS.map((s) => {
            const value = calibration.profile[s.key] as number
            return (
              <label key={s.key} className="slider">
                <span className="slider-top">
                  <b>{s.label}</b>
                  <output data-testid={`value-${s.key}`}>{value.toFixed(s.step < 0.1 ? 2 : s.step < 1 ? 1 : 0)}{s.unit}</output>
                </span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={value} onChange={(e) => setProfile({ [s.key]: Number(e.target.value) })} />
                <small>{s.hint}</small>
              </label>
            )
          })}
          <label className="slider">
            <span className="slider-top"><b>Stroke ends</b></span>
            <select value={calibration.profile.terminal} onChange={(e) => setProfile({ terminal: e.target.value as Terminal })}>
              <option value="round">Round, like a felt tip</option>
              <option value="flat">Flat, like a chisel marker</option>
              <option value="tapered">Tapered, like a brush or a quick ballpoint</option>
            </select>
            <small>how a stroke starts and finishes</small>
          </label>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2><span>3</span> Try it</h2>
          <div className="tools">
            <label className="inline">
              Size
              <input type="range" min={20} max={140} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Preview size" />
            </label>
          </div>
        </div>
        <textarea
          className="preview"
          data-testid="preview"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{ fontFamily: font ? `"${font.family}", cursive` : 'cursive', fontSize: size }}
          aria-label="Type to try your font"
        />
        <div className="charmap" style={{ fontFamily: font ? `"${font.family}"` : undefined }} aria-label="All 90 glyphs">
          {CHARSET.map((char) => (
            <span key={char} className={`glyph ${glyphSource.get(char) ?? 'skeleton'}`} title={glyphSource.get(char) === 'skeleton' ? 'derived from your style' : 'from your own letter'}>{char}</span>
          ))}
        </div>
        <p className="legend">
          <span className="key sample" /> {bySource('sample') + bySource('blend')} from your own letters
          <span className="key skeleton" /> {bySource('skeleton')} derived from your style
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2><span>4</span> Take it home</h2>
        </div>
        <div className="export">
          <label className="name">
            Font name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={!font} data-testid="download-ttf" onClick={() => font && download(font.ttf, `${fileBase}.ttf`, 'font/ttf')}>Download .ttf</button>
          <button type="button" disabled={!font} data-testid="download-woff2" onClick={() => font && download(font.woff2, `${fileBase}.woff2`, 'font/woff2')}>Download .woff2</button>
        </div>
        {font && (
          <p className="stats" data-testid="stats">
            Built in {font.ms.toFixed(0)} ms. {(font.ttf.length / 1024).toFixed(1)} KB as TrueType, {(font.woff2.length / 1024).toFixed(1)} KB as WOFF2. Open the .ttf to install it in Font Book or Windows Settings.
          </p>
        )}
        <div className="posters">
          {POSTER_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              className="poster"
              disabled={!font}
              data-testid={style.id}
              onClick={async () => font && download(await renderPoster(style, font.family, name || 'My Hand', calibration.profile), `${fileBase}-${style.name.toLowerCase()}.png`, 'image/png')}
            >
              <span className={`swatch ${style.id}`} />
              <b>{style.name}</b>
              <small>specimen poster, PNG</small>
            </button>
          ))}
        </div>
      </section>

      <footer>
        The skeleton alphabet is Hershey Roman Simplex. The Hershey Fonts were originally created by
        Dr. A. V. Hershey while working at the U.S. National Bureau of Standards. Everything else
        happens in your browser.
      </footer>
    </div>
  )
}
