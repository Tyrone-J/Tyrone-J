/* ============================================================
   TETRIS AUTOPLAY — animated SVG generator for the profile README
   Ports the heuristic-AI board logic (SHAPES / rotate / normalize /
   planDrop) from the canvas version to a headless simulation, then
   bakes the whole match into a single self-contained SVG driven by
   CSS keyframes (no JS — GitHub sanitizes scripts out of READMEs).

   Usage:  node .github/scripts/tetris-svg.mjs [outfile] [seed]
   ============================================================ */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/* ---------- board / tetromino model (ported) ---------- */

const COLS = 10
const ROWS = 18

const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[0, 1], [1, 1], [2, 1], [1, 0]],
  S: [[1, 1], [2, 1], [0, 2], [1, 2]],
  Z: [[0, 1], [1, 1], [1, 2], [2, 2]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
}

/* techwear palette — black / white / orange only */
const PALETTE = {
  orange: '#FF6B00',
  orangeB: '#FF8C2B',
  amber: '#FFA552',
  white: '#F0EEE9',
  bone: '#C9C5BD',
  steel: '#6E6E6E',
}

/* distribution: mostly orange/white, occasional muted accents */
const PIECE_COLORS = [
  'orange', 'orange', 'white', 'orangeB', 'white',
  'orange', 'bone', 'amber', 'white', 'steel', 'orange',
]

const rotate = (cells) => {
  const xs = cells.map(c => c[0]); const ys = cells.map(c => c[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return cells.map(([x, y]) => [Math.round(cx + (y - cy)), Math.round(cy - (x - cx))])
}

const normalize = (cells) => {
  const minx = Math.min(...cells.map(c => c[0]))
  const miny = Math.min(...cells.map(c => c[1]))
  return cells.map(([x, y]) => [x - minx, y - miny])
}

/* seeded RNG so the committed SVG is reproducible */
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/* ---------- simulation ---------- */

function simulate(seed, maxFrames) {
  const rnd = mulberry32(seed)
  const keys = Object.keys(SHAPES)
  let grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  const frames = []
  let lines = 0
  let pieces = 0

  const collide = (cells, ox, oy) => {
    for (const [x, y] of cells) {
      const gx = x + ox; const gy = y + oy
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true
      if (gy >= 0 && grid[gy][gx]) return true
    }
    return false
  }

  /* heuristic placement: minimise holes, aggregate height and max height */
  const planDrop = (baseCells, color) => {
    let best = null
    for (let r = 0; r < 4; r++) {
      let cells = baseCells
      for (let i = 0; i < r; i++) cells = rotate(cells)
      cells = normalize(cells)
      const w = Math.max(...cells.map(c => c[0])) + 1
      for (let ox = 0; ox <= COLS - w; ox++) {
        let oy = -2
        while (!collide(cells, ox, oy + 1)) oy++
        let agg = 0; let holes = 0; let maxh = 0
        const test = grid.map(row => row.slice())
        for (const [x, y] of cells) { if (y + oy >= 0) test[y + oy][x + ox] = color }
        for (let c = 0; c < COLS; c++) {
          let h = 0; let seen = false
          for (let rr = 0; rr < ROWS; rr++) {
            if (test[rr][c]) { if (!seen) { h = ROWS - rr; seen = true } }
            else if (seen) holes++
          }
          agg += h; maxh = Math.max(maxh, h)
        }
        let cleared = 0
        for (let rr = 0; rr < ROWS; rr++) { if (test[rr].every(v => v)) cleared++ }
        const score = cleared * 3.5 - holes * 2.2 - agg * 0.12 - maxh * 0.2 + rnd() * 0.4
        if (!best || score > best.score) best = { score, cells, ox, oy }
      }
    }
    return best
  }

  const pick = () => ({
    key: keys[Math.floor(rnd() * keys.length)],
    color: PIECE_COLORS[Math.floor(rnd() * PIECE_COLORS.length)],
  })

  /* a frame is { board: flat array of color keys|null, next: 4x4 flat, lines, pieces } */
  const snapshot = (active, next, override) => {
    const board = new Array(ROWS * COLS).fill(null)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) board[r * COLS + c] = grid[r][c]
    }
    if (active) {
      for (const [x, y] of active.cells) {
        const gy = y + active.y; const gx = x + active.x
        if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) board[gy * COLS + gx] = active.color
      }
    }
    if (override) override(board)
    frames.push({ board, next: nextMini(next), lines, pieces })
  }

  const nextMini = (next) => {
    const mini = new Array(16).fill(null)
    if (!next) return mini
    const cells = normalize(SHAPES[next.key].map(c => c.slice()))
    const w = Math.max(...cells.map(c => c[0])) + 1
    const h = Math.max(...cells.map(c => c[1])) + 1
    const dx = Math.floor((4 - w) / 2); const dy = Math.floor((4 - h) / 2)
    for (const [x, y] of cells) mini[(y + dy) * 4 + (x + dx)] = next.color
    return mini
  }

  let current = pick()
  let next = pick()

  while (frames.length < maxFrames) {
    const base = SHAPES[current.key].map(c => c.slice())
    const plan = planDrop(base, current.color)
    if (!plan) break

    /* descent, one row per frame */
    const active = { cells: plan.cells, color: current.color, x: plan.ox, y: -2 }
    for (let y = -2; y <= plan.oy; y++) {
      active.y = y
      snapshot(active, next)
      if (frames.length >= maxFrames) break
    }

    /* lock */
    for (const [x, y] of active.cells) {
      const gy = y + plan.oy; const gx = x + plan.ox
      if (gy >= 0 && gy < ROWS) grid[gy][gx] = active.color
    }
    pieces++

    /* line clear: blink, then collapse */
    const full = []
    for (let r = 0; r < ROWS; r++) { if (grid[r].every(v => v)) full.push(r) }
    if (full.length) {
      for (let b = 0; b < 4; b++) {
        snapshot(null, next, (board) => {
          for (const r of full) {
            for (let c = 0; c < COLS; c++) board[r * COLS + c] = b % 2 === 0 ? 'white' : null
          }
        })
      }
      full.sort((a, b) => a - b)
      for (const r of full) { grid.splice(r, 1); grid.unshift(Array(COLS).fill(null)) }
      lines += full.length
      snapshot(null, next)
    }

    /* top-out: clear the well and keep playing so the loop never dies */
    if (grid[0].some(v => v) || grid[1].some(v => v)) {
      for (let b = 0; b < 3; b++) {
        snapshot(null, next, (board) => { if (b % 2 === 0) board.fill(null) })
      }
      grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
      lines = 0
      snapshot(null, next)
    }

    current = next
    next = pick()
  }

  return frames
}

/* ---------- SVG emitter ---------- */

const CELL = 20
const PAD = 16
const HEAD = 34
const BOARD_W = COLS * CELL
const BOARD_H = ROWS * CELL
const SIDE_W = 92
const W = PAD + BOARD_W + 12 + SIDE_W + PAD
const H = PAD + HEAD + BOARD_H + PAD

const BX = PAD
const BY = PAD + HEAD
const SX = PAD + BOARD_W + 12

const MINI = 17
const MX = SX + (SIDE_W - MINI * 4) / 2
const MY = BY + 30

/* build one @keyframes rule from a per-frame value series, emitting
   only the points where the value actually changes */
function keyframesFor(series, n, toDecl) {
  const parts = []
  let prev = Symbol('none')
  for (let i = 0; i < n; i++) {
    const v = series[i]
    if (v === prev) continue
    prev = v
    const pct = (i / n) * 100
    parts.push(`${pct.toFixed(3).replace(/\.?0+$/, '')}%{${toDecl(v)}}`)
  }
  return parts
}

function build(frames, opts) {
  const n = frames.length
  const dur = (n * opts.frameMs / 1000).toFixed(1)
  const css = []
  const body = []

  const fillDecl = (v) => `fill:${v ? PALETTE[v] : 'transparent'}`

  /* board cells */
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c
      const series = frames.map(f => f.board[i])
      const kf = keyframesFor(series, n, fillDecl)
      const x = BX + c * CELL + 1.5
      const y = BY + r * CELL + 1.5
      const s = CELL - 3
      if (kf.length <= 1) {
        const v = series[0]
        if (v) body.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" fill="${PALETTE[v]}"/>`)
        continue
      }
      css.push(`@keyframes b${i}{${kf.join('')}}`)
      body.push(`<rect class="b" style="animation-name:b${i}" x="${x}" y="${y}" width="${s}" height="${s}" rx="3"/>`)
    }
  }

  /* next-piece preview */
  for (let i = 0; i < 16; i++) {
    const series = frames.map(f => f.next[i])
    const kf = keyframesFor(series, n, fillDecl)
    const x = MX + (i % 4) * MINI + 1.5
    const y = MY + Math.floor(i / 4) * MINI + 1.5
    const s = MINI - 3
    if (kf.length <= 1) {
      const v = series[0]
      if (v) body.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="2" fill="${PALETTE[v]}"/>`)
      continue
    }
    css.push(`@keyframes n${i}{${kf.join('')}}`)
    body.push(`<rect class="b" style="animation-name:n${i}" x="${x}" y="${y}" width="${s}" height="${s}" rx="2"/>`)
  }

  /* readouts: one <text> per distinct value, toggled with opacity */
  const readout = (field, prefix, x, y, cls) => {
    const distinct = [...new Set(frames.map(f => f[field]))]
    for (const v of distinct) {
      const series = frames.map(f => (f[field] === v ? 1 : 0))
      const kf = keyframesFor(series, n, (o) => `opacity:${o}`)
      const label = String(v).padStart(3, '0')
      if (kf.length <= 1) {
        body.push(`<text class="${cls}" style="opacity:1" x="${x}" y="${y}">${label}</text>`)
        continue
      }
      css.push(`@keyframes ${prefix}${v}{${kf.join('')}}`)
      body.push(`<text class="${cls}" style="animation-name:${prefix}${v}" x="${x}" y="${y}">${label}</text>`)
    }
  }
  readout('lines', 'l', SX, BY + 165, 'num')
  readout('pieces', 'p', SX, BY + 225, 'num')

  /* static chrome: grid, frame, corner brackets, labels */
  const grid = []
  for (let c = 0; c <= COLS; c++) {
    grid.push(`M${BX + c * CELL} ${BY}V${BY + BOARD_H}`)
  }
  for (let r = 0; r <= ROWS; r++) {
    grid.push(`M${BX} ${BY + r * CELL}H${BX + BOARD_W}`)
  }

  const br = 12
  const brackets = [
    `M${PAD - 6} ${PAD + br}V${PAD - 6}H${PAD + br}`,
    `M${W - PAD - br} ${PAD - 6}H${W - PAD + 6}V${PAD + br}`,
    `M${W - PAD + 6} ${H - PAD - br}V${H - PAD + 6}H${W - PAD - br}`,
    `M${PAD + br} ${H - PAD + 6}H${PAD - 6}V${H - PAD - br}`,
  ]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Auto-playing Tetris board">
<title>TETRIS // AUTOPLAY</title>
<defs>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ffffff" stop-opacity=".07"/>
<stop offset=".55" stop-color="#ffffff" stop-opacity="0"/>
</linearGradient>
</defs>
<style>
.b{animation-duration:${dur}s;animation-timing-function:steps(1,end);animation-iteration-count:infinite;fill:transparent}
text{font-family:ui-monospace,"JetBrains Mono","SFMono-Regular",Consolas,monospace;dominant-baseline:middle}
.tag{font-size:11px;font-weight:700;letter-spacing:.18em;fill:#FF6B00}
.sub{font-size:9px;letter-spacing:.16em;fill:#6E6E6E}
.lbl{font-size:9px;font-weight:700;letter-spacing:.18em;fill:#6E6E6E}
.num{font-size:26px;font-weight:700;letter-spacing:.04em;fill:#F0EEE9;opacity:0;animation-duration:${dur}s;animation-timing-function:steps(1,end);animation-iteration-count:infinite}
@media (prefers-reduced-motion:reduce){.b,.num{animation:none}.num{opacity:0}}
${css.join('\n')}
</style>
<rect width="${W}" height="${H}" rx="10" fill="#0D1117"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="#23262D"/>
<path d="${brackets.join(' ')}" fill="none" stroke="#FF6B00" stroke-width="1.5" stroke-linecap="square"/>
<text class="tag" x="${PAD}" y="${PAD + 11}">TETRIS</text>
<text class="sub" x="${PAD + 62}" y="${PAD + 11}">// AUTOPLAY</text>
<text class="sub" x="${W - PAD}" y="${PAD + 11}" text-anchor="end">10 × 18</text>
<path d="M${PAD} ${PAD + 22}H${W - PAD}" stroke="#23262D"/>
<rect x="${BX}" y="${BY}" width="${BOARD_W}" height="${BOARD_H}" fill="#08090C"/>
<path d="${grid.join('')}" stroke="#FFFFFF" stroke-opacity=".045" stroke-width="1"/>
${body.join('\n')}
<rect x="${BX}" y="${BY}" width="${BOARD_W}" height="${BOARD_H}" fill="url(#sheen)"/>
<rect x="${BX - .5}" y="${BY - .5}" width="${BOARD_W + 1}" height="${BOARD_H + 1}" fill="none" stroke="#FF6B00" stroke-opacity=".45"/>
<text class="lbl" x="${SX}" y="${BY + 10}">NEXT</text>
<rect x="${MX - 4}" y="${MY - 4}" width="${MINI * 4 + 8}" height="${MINI * 4 + 8}" rx="4" fill="none" stroke="#23262D"/>
<text class="lbl" x="${SX}" y="${BY + 143}">LINES</text>
<text class="lbl" x="${SX}" y="${BY + 203}">PIECES</text>
<path d="M${SX} ${BY + 253}H${SX + SIDE_W}" stroke="#23262D"/>
<text class="sub" x="${SX}" y="${BY + 268}">HEURISTIC</text>
<text class="sub" x="${SX}" y="${BY + 282}">AI  //  ON</text>
</svg>
`
}

/* ---------- main ---------- */

const out = process.argv[2] || 'assets/tetris.svg'
const seed = Number(process.argv[3] || 20260807)
const frames = simulate(seed, 780)
const svg = build(frames, { frameMs: 60 })

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, svg)

const kb = (Buffer.byteLength(svg) / 1024).toFixed(1)
console.log(`${out}  ${frames.length} frames  ${(frames.length * 60 / 1000).toFixed(1)}s loop  ${kb} KB`)
