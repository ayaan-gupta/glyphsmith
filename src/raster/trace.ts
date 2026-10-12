import type { Point } from '../core/types'

/**
 * Zhang-Suen thinning. Peels a binary shape from both sides, two sub-passes
 * at a time, until what is left is a line one pixel wide that runs down the
 * middle of every stroke. Works in place on a copy and returns it.
 */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const img = new Uint8Array(mask)
  const remove: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      remove.length = 0
      for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x
          if (!img[i]) continue
          const p2 = img[i - width]!, p3 = img[i - width + 1]!, p4 = img[i + 1]!, p5 = img[i + width + 1]!
          const p6 = img[i + width]!, p7 = img[i + width - 1]!, p8 = img[i - 1]!, p9 = img[i - width - 1]!
          const neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (neighbours < 2 || neighbours > 6) continue
          // Number of 0 to 1 steps walking once around the pixel.
          const transitions =
            (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) +
            (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0)
          if (transitions !== 1) continue
          if (pass === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) remove.push(i)
        }
      for (const i of remove) img[i] = 0
      if (remove.length) changed = true
    }
  }
  // Thinning leaves staircase corners: pixels with two orthogonal neighbours
  // that are not needed to keep the line connected. Removing them makes
  // "exactly two neighbours" a reliable definition of a plain path pixel.
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (!img[i]) continue
      const n = img[i - width]!, e = img[i + 1]!, s = img[i + width]!, w = img[i - 1]!
      const ne = img[i - width + 1]!, se = img[i + width + 1]!, sw = img[i + width - 1]!, nw = img[i - width - 1]!
      if ((n && e && !sw && !s && !w) || (e && s && !nw && !n && !w) || (s && w && !ne && !n && !e) || (w && n && !se && !s && !e)) img[i] = 0
    }
  return img
}

/** Chamfer distance (weights 3 and 4) from each ink pixel to the nearest paper pixel, in pixels. */
export function distanceToPaper(mask: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(mask.length)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]!)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!d[i]) continue
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (!d[i]) continue
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3
  return d
}

export interface TracedStroke {
  points: Point[]
  /** Full pen width at each point, in pixels. */
  widths: number[]
  closed: boolean
}

const OFFSETS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const

/**
 * Walks a one-pixel skeleton and returns it as pen strokes.
 *
 * Pixels with two neighbours are path. Anything else is a node: one neighbour
 * is a loose end, three or more is a junction. Paths are followed from node
 * to node, short spurs left over from thinning are dropped, and at each
 * junction the two branches that continue each other most directly are
 * rejoined. That last step is what turns the four arms of a "t" back into a
 * stem and a crossbar.
 */
export function traceSkeleton(skeleton: Uint8Array, distance: Float32Array, width: number, height: number): TracedStroke[] {
  const neighbours = (i: number): number[] => {
    const x = i % width
    const y = (i - x) / width
    const out: number[] = []
    for (const [dx, dy] of OFFSETS) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && skeleton[ny * width + nx]) out.push(ny * width + nx)
    }
    return out
  }
  const degree = new Uint8Array(skeleton.length)
  const pixels: number[] = []
  for (let i = 0; i < skeleton.length; i++) {
    if (!skeleton[i]) continue
    pixels.push(i)
    degree[i] = neighbours(i).length
  }
  const isNode = (i: number) => degree[i] !== 2

  // Junction pixels that touch each other are one junction.
  const nodeOf = new Int32Array(skeleton.length).fill(-1)
  const nodes: Array<{ x: number; y: number; count: number }> = []
  for (const start of pixels) {
    if (!isNode(start) || nodeOf[start] !== -1) continue
    const id = nodes.length
    const node = { x: 0, y: 0, count: 0 }
    const stack = [start]
    nodeOf[start] = id
    while (stack.length) {
      const i = stack.pop()!
      node.x += i % width
      node.y += Math.floor(i / width)
      node.count++
      if (degree[i]! < 3) continue // endpoints do not merge with their neighbour
      for (const n of neighbours(i)) if (degree[n]! >= 3 && nodeOf[n] === -1) { nodeOf[n] = id; stack.push(n) }
    }
    node.x /= node.count
    node.y /= node.count
    nodes.push(node)
  }

  interface Path { a: number; b: number; pixels: number[] }
  const visited = new Uint8Array(skeleton.length)
  const paths: Path[] = []
  const direct = new Set<string>()
  for (const start of pixels) {
    if (!isNode(start)) continue
    for (const first of neighbours(start)) {
      if (isNode(first)) {
        // Two different nodes touching with no path pixel between them.
        const a = nodeOf[start]!, b = nodeOf[first]!
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        if (a !== b && !direct.has(key)) { direct.add(key); paths.push({ a, b, pixels: [] }) }
        continue
      }
      if (visited[first]) continue
      const run = [first]
      visited[first] = 1
      let prev = start
      let cur = first
      let end = -1
      for (;;) {
        const next = neighbours(cur).filter((n) => n !== prev)
        const node = next.find((n) => isNode(n) && (run.length > 1 || n !== start))
        if (node !== undefined) { end = node; break }
        const step = next.find((n) => !visited[n] && !isNode(n))
        if (step === undefined) break
        visited[step] = 1
        run.push(step)
        prev = cur
        cur = step
      }
      paths.push({ a: nodeOf[start]!, b: end >= 0 ? nodeOf[end]! : -1, pixels: run })
    }
  }

  const toStroke = (ids: number[], closed: boolean): TracedStroke => ({
    points: ids.map((i) => ({ x: i % width, y: Math.floor(i / width) })),
    widths: ids.map((i) => Math.max(1, distance[i]! * 2)),
    closed,
  })

  // What is left untouched is a loop with no node on it, such as a clean "o".
  const strokes: TracedStroke[] = []
  for (const start of pixels) {
    if (visited[start] || isNode(start)) continue
    const loop = [start]
    visited[start] = 1
    let cur = start
    for (;;) {
      const step = neighbours(cur).find((n) => !visited[n])
      if (step === undefined) break
      visited[step] = 1
      loop.push(step)
      cur = step
    }
    if (loop.length > 6) strokes.push(toStroke([...loop, loop[0]!], true))
  }

  // Build point lists that include the node positions at each end.
  interface Branch { a: number; b: number; pts: Point[]; widths: number[] }
  let branches: Branch[] = paths.map((p) => {
    const inner = toStroke(p.pixels, false)
    const first = inner.widths[0] ?? 2
    const last = inner.widths[inner.widths.length - 1] ?? first
    const pts = [...inner.points]
    const widths = [...inner.widths]
    if (p.a >= 0) { pts.unshift({ x: nodes[p.a]!.x, y: nodes[p.a]!.y }); widths.unshift(first) }
    if (p.b >= 0) { pts.push({ x: nodes[p.b]!.x, y: nodes[p.b]!.y }); widths.push(last) }
    return { a: p.a, b: p.b, pts, widths }
  })

  const lengthOf = (b: Branch) => b.pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - b.pts[i - 1]!.x, p.y - b.pts[i - 1]!.y) : 0), 0)
  const incident = (id: number) => branches.filter((b) => b.a === id || b.b === id)

  // Drop spurs: a short branch from a junction to a loose end is thinning noise.
  const means = branches.map((b) => b.widths.reduce((x, y) => x + y, 0) / Math.max(1, b.widths.length)).sort((x, y) => x - y)
  const typical = means.length ? means[means.length >> 1]! : 2
  branches = branches.filter((b) => {
    const ends = [b.a, b.b].map((id) => (id < 0 ? 0 : incident(id).length))
    const spur = (ends[0]! <= 1 && ends[1]! >= 3) || (ends[1]! <= 1 && ends[0]! >= 3)
    return !(spur && lengthOf(b) < typical * 1.6)
  })

  // Rejoin through junctions, straightest pair first.
  const heading = (b: Branch, id: number): Point => {
    const pts = b.a === id ? b.pts : [...b.pts].reverse()
    const far = pts[Math.min(pts.length - 1, 8)]!
    const len = Math.hypot(far.x - pts[0]!.x, far.y - pts[0]!.y) || 1
    return { x: (far.x - pts[0]!.x) / len, y: (far.y - pts[0]!.y) / len }
  }
  for (let id = 0; id < nodes.length; id++) {
    for (;;) {
      const here = incident(id).filter((b) => b.a !== b.b)
      if (here.length < 2) break
      // Two arms simply continue each other. With three or more, a pair is
      // only joined when the arms point roughly opposite ways.
      let best: [Branch, Branch] | null = null
      let bestDot = here.length === 2 ? 2 : -0.2
      for (let i = 0; i < here.length; i++)
        for (let j = i + 1; j < here.length; j++) {
          const u = heading(here[i]!, id)
          const v = heading(here[j]!, id)
          const dot = u.x * v.x + u.y * v.y
          if (dot < bestDot) { bestDot = dot; best = [here[i]!, here[j]!] }
        }
      if (!best) break
      const [p, q] = best
      const left = p.b === id ? p : { a: p.b, b: p.a, pts: [...p.pts].reverse(), widths: [...p.widths].reverse() }
      const right = q.a === id ? q : { a: q.b, b: q.a, pts: [...q.pts].reverse(), widths: [...q.widths].reverse() }
      branches = branches.filter((b) => b !== p && b !== q)
      branches.push({ a: left.a, b: right.b, pts: [...left.pts, ...right.pts.slice(1)], widths: [...left.widths, ...right.widths.slice(1)] })
    }
  }

  for (const b of branches) {
    if (b.pts.length < 2) continue
    strokes.push({ points: b.pts, widths: b.widths, closed: b.a >= 0 && b.a === b.b })
  }
  return strokes
}
