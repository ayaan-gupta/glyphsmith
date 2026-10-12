import { useEffect, useRef } from 'react'
import type { Stroke } from '../core/types'
import { clientToFont, GUIDE, GUIDES, INK, VIEW, VIEW_HEIGHT, VIEW_WIDTH } from './view'

interface Props {
  char: string
  strokes: Stroke[]
  penWidth: number
  onChange: (strokes: Stroke[]) => void
}

/**
 * One letter's drawing surface. Pointer positions are converted to font units
 * as they arrive, so what gets stored is already in the coordinate system the
 * rest of the pipeline uses and the canvas size never matters again.
 */
export function DrawCell({ char, strokes, penWidth, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef<Stroke | null>(null)
  const latest = useRef(strokes)
  latest.current = strokes

  const paint = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')!
    const k = (w / VIEW_WIDTH) * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Font space has y pointing up; the canvas has it pointing down.
    ctx.setTransform(k, 0, 0, -k, -VIEW.minX * k, VIEW.maxY * k)

    for (const g of GUIDES) {
      ctx.beginPath()
      ctx.moveTo(VIEW.minX, g.y)
      ctx.lineTo(VIEW.maxX, g.y)
      ctx.strokeStyle = GUIDE
      ctx.lineWidth = (g.strong ? 2.2 : 1) / k * dpr
      ctx.stroke()
    }

    ctx.strokeStyle = INK
    ctx.fillStyle = INK
    ctx.lineWidth = penWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of live.current ? [...latest.current, live.current] : latest.current) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0]!.x, stroke[0]!.y)
      for (const p of stroke) ctx.lineTo(p.x, p.y)
      if (stroke.length === 1) ctx.arc(stroke[0]!.x, stroke[0]!.y, penWidth / 2, 0, Math.PI * 2), ctx.fill()
      else ctx.stroke()
    }
  }

  useEffect(paint)
  useEffect(() => {
    const observer = new ResizeObserver(paint)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [])

  const toFont = (event: { clientX: number; clientY: number }) =>
    clientToFont(canvasRef.current!.getBoundingClientRect(), event.clientX, event.clientY)

  return (
    <div className="cell" data-char={char}>
      <canvas
        ref={canvasRef}
        style={{ aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}` }}
        aria-label={`Draw the letter ${char}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          live.current = [toFont(e)]
          paint()
        }}
        onPointerMove={(e) => {
          if (!live.current) return
          // Coalesced events are the samples the browser merged into one
          // frame. Using them keeps fast strokes from turning into polygons.
          const events = e.nativeEvent.getCoalescedEvents?.() ?? []
          for (const ev of events.length ? events : [e.nativeEvent]) live.current.push(toFont(ev))
          paint()
        }}
        onPointerUp={() => {
          if (!live.current) return
          const done = live.current
          live.current = null
          onChange([...latest.current, done])
        }}
        onPointerCancel={() => {
          live.current = null
          paint()
        }}
      />
      {/* The label and redo sit under the canvas, never over it. They used to
          float in the top corners, where the redo button swallowed the first
          touch of any stroke that starts high on the right, such as the stem
          of a "d". */}
      <div className="cell-foot">
        <span className="cell-label" aria-hidden>{char}</span>
        <button type="button" className="redo" disabled={strokes.length === 0} onClick={() => onChange([])} aria-label={`Redo ${char}`}>
          redo
        </button>
      </div>
    </div>
  )
}
