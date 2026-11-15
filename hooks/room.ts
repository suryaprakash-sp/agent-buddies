import type { Buddy } from '../types'
import { FIGURES, figure, hex, toBase64 } from './sprites'
import type { Size } from './sprites'

// The room is one Raster in half blocks: `cols` cells wide and `rows` cells
// tall is `cols` x `rows * 2` square pixels. Buddies are bodies in pixel space
// that wander at random, bounce off the walls and off each other.

export type Body = { id: string; x: number; y: number; vx: number; vy: number }
export type Rng = () => number
export type Star = { x: number; y: number; phase: number }

/** Pixels per frame (10 frames a second): working buddies roam, others amble. */
const SPEED: Record<Buddy['status'], [number, number]> = {
  running: [0.35, 0.9],
  waiting: [0.1, 0.3],
  done: [0.2, 0.5],
  failed: [0.05, 0.15],
}
/** The random push each frame, and the odd sudden turn, so no path repeats. */
const WANDER = 0.14
const TURN_CHANCE = 0.015
/** How far a walking buddy hops, in pixels. */
const HOP = 1

const DEFAULT = 0x01000000
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20
const STAR_DIM = 0x36323f
const STAR_BRIGHT = 0x8a84b0

/** Keeps one body per shown buddy: new ones land on the freest spot found, gone ones leave. */
export const syncBodies = (
  bodies: Map<string, Body>,
  shown: Buddy[],
  w: number,
  h: number,
  size: Size,
  rng: Rng,
) => {
  const ids = new Set(shown.map(b => b.id))
  for (const id of [...bodies.keys()]) if (!ids.has(id)) bodies.delete(id)
  const fig = FIGURES[size]
  for (const b of shown) {
    if (bodies.has(b.id)) continue
    let best = { x: w / 2, y: h / 2 }
    let bestGap = -1
    for (let i = 0; i < 24; i += 1) {
      const x = fig.w / 2 + rng() * Math.max(0, w - fig.w)
      const y = fig.h / 2 + HOP + rng() * Math.max(0, h - fig.h - HOP)
      const gap = Math.min(Number.MAX_VALUE, ...[...bodies.values()].map(o => Math.hypot(o.x - x, o.y - y)))
      if (gap > bestGap) {
        best = { x, y }
        bestGap = gap
      }
      if (gap > fig.radius * 3) break
    }
    const angle = rng() * Math.PI * 2
    bodies.set(b.id, { id: b.id, x: best.x, y: best.y, vx: Math.cos(angle) * 0.5, vy: Math.sin(angle) * 0.5 })
  }
}

/**
 * One frame of physics: a random push and the odd turn, speed kept within
 * the buddy's band, then collisions (equal-mass elastic, overlap pushed
 * apart) and the walls (reflect).
 */
export const stepRoom = (
  bodies: Map<string, Body>,
  byId: Map<string, Buddy>,
  w: number,
  h: number,
  size: Size,
  rng: Rng,
) => {
  const fig = FIGURES[size]
  const list = [...bodies.values()]
  for (const body of list) {
    const [min, max] = SPEED[byId.get(body.id)?.status ?? 'running']
    body.vx += (rng() - 0.5) * WANDER
    body.vy += (rng() - 0.5) * WANDER
    let speed = Math.hypot(body.vx, body.vy)
    if (rng() < TURN_CHANCE || speed < 1e-6) {
      const angle = rng() * Math.PI * 2
      body.vx = Math.cos(angle) * Math.max(speed, min)
      body.vy = Math.sin(angle) * Math.max(speed, min)
      speed = Math.hypot(body.vx, body.vy)
    }
    const k = speed < min ? min / speed : speed > max ? max / speed : 1
    body.vx *= k
    body.vy *= k
    body.x += body.vx
    body.y += body.vy
  }
  const reach = fig.radius * 2
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]!
      const b = list[j]!
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist = Math.hypot(dx, dy)
      if (dist >= reach) continue
      if (dist < 1e-6) {
        dx = rng() - 0.5
        dy = rng() - 0.5
        dist = Math.hypot(dx, dy)
      }
      const nx = dx / dist
      const ny = dy / dist
      const push = (reach - dist) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      if (closing > 0) {
        a.vx -= closing * nx
        a.vy -= closing * ny
        b.vx += closing * nx
        b.vy += closing * ny
      }
    }
  }
  // A pixel of headroom at the top for the walking hop, so a hop never clips the bar.
  const halfW = fig.w / 2
  const top = fig.h / 2 + HOP
  const bottom = h - fig.h / 2
  for (const body of list) {
    if (body.x < halfW) [body.x, body.vx] = [halfW, Math.abs(body.vx)]
    if (body.x > w - halfW) [body.x, body.vx] = [Math.max(halfW, w - halfW), -Math.abs(body.vx)]
    if (bottom <= top) [body.y, body.vy] = [(top + bottom) / 2, 0]
    else if (body.y < top) [body.y, body.vy] = [top, Math.abs(body.vy)]
    else if (body.y > bottom) [body.y, body.vy] = [bottom, -Math.abs(body.vy)]
  }
}

/** A sparse, fixed starfield for a room of this size; a few twinkle each moment. */
export const starsFor = (cols: number, rows: number): Star[] => {
  let seed = (cols * 7919 + rows * 104729) >>> 0
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const count = Math.max(3, Math.round((cols * rows * 2) / 120))
  return Array.from({ length: count }, () => ({
    x: Math.floor(next() * cols),
    y: Math.floor(next() * rows * 2),
    phase: Math.floor(next() * 40),
  }))
}

export type Pixels = (number | null)[][]

/** The room's pixels this frame: stars, then each buddy, the lower ones drawn last (in front). */
export const roomPixels = (
  bodies: Map<string, Body>,
  byId: Map<string, Buddy>,
  cols: number,
  rows: number,
  size: Size,
  frame: number,
  stars: Star[],
): Pixels => {
  const px: Pixels = Array.from({ length: rows * 2 }, () => Array<number | null>(cols).fill(null))
  for (const star of stars) {
    const row = px[star.y]
    if (row !== undefined) row[star.x] = (frame + star.phase) % 40 < 3 ? STAR_BRIGHT : STAR_DIM
  }
  const ordered = [...bodies.values()].sort((a, b) => a.y - b.y)
  for (const body of ordered) {
    const buddy = byId.get(body.id)
    if (buddy === undefined) continue
    const isMoving = Math.hypot(body.vx, body.vy) > 0.05
    const fig = figure(buddy, frame, size, isMoving)
    const hop = isMoving && Math.floor(frame / 3 + buddy.seat) % 2 === 1 ? HOP : 0
    const x0 = Math.round(body.x - fig.w / 2)
    const y0 = Math.round(body.y - fig.h / 2) - hop
    fig.px.forEach((line, r) =>
      line.forEach((color, c) => {
        const row = px[y0 + r]
        if (color !== null && row !== undefined && x0 + c >= 0 && x0 + c < cols) row[x0 + c] = color
      }),
    )
  }
  return px
}

/** The pixels as Raster cells: each cell an upper half block over its lower pixel. */
export const roomCells = (px: Pixels, cols: number, rows: number): string => {
  const words = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const top = px[r * 2]?.[c] ?? null
      const bottom = px[r * 2 + 1]?.[c] ?? null
      const at = (r * cols + c) * 3
      if (top === null && bottom === null) words.set([SPACE, DEFAULT, DEFAULT], at)
      else if (top === null) words.set([LOWER_HALF, bottom!, DEFAULT], at)
      else words.set([UPPER_HALF, top, bottom ?? DEFAULT], at)
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

/** The same pixels as an SVG, for the desktop surface, which has no Raster. */
export const roomSvg = (px: Pixels, cols: number, rows: number): string => {
  const rects: string[] = []
  px.forEach((line, y) =>
    line.forEach((color, x) => {
      if (color !== null) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${hex(color)}"/>`)
    }),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${rows * 2}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}
