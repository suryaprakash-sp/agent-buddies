import type { Buddy } from '../types'

// A buddy is a small pixel figure: its 5-segment progress bar on top, a
// pixel of air, then the sprite. The room draws figures in half blocks (one
// terminal cell holds two stacked pixels), so pixels come out square.
//
// normal: 7 x 6 sprite under a 9-pixel dotted bar, a 9 x 8 figure.
// mini:   5 x 4 sprite under a 5-pixel solid bar, a 5 x 6 figure: little
//         round faces (ears, antenna or tuft, eyes, cheeks), no legs, since
//         legs at this height read as a crab.
//
// Pixel keys: B body, D body shade, L body highlight, E eye, W eye white,
// P cheek, O accent (beak, feet, antenna light), . transparent. Faces are
// close-set dot eyes over pink cheeks with no mouth, which reads as cute at
// this size; a dark mouth reads as a scream.

export type Size = 'normal' | 'mini'

type Frames = { rows: string[]; alt: Record<number, string> }
type Sprite = { name: string; normal: Frames; mini: Frames }

const SPRITES: Sprite[] = [
  {
    name: 'blob',
    normal: {
      rows: ['..BBB..', '.BLBBB.', 'BBEBEBB', 'BPBBBPB', '.BBBBB.', '..D.D..'],
      alt: { 5: '.D...D.' },
    },
    mini: { rows: ['.BBB.', 'BEBEB', 'PBBBP', '.BBB.'], alt: { 3: 'BBBBB' } },
  },
  {
    name: 'cat',
    normal: {
      rows: ['.B...B.', '.BBBBB.', 'BBEBEBB', 'BPBBBPB', '.BBBBBB', '.B...B.'],
      alt: { 5: '..B.B..' },
    },
    mini: { rows: ['B...B', 'BBBBB', 'BEBEB', 'PBBBP'], alt: { 0: '.B..B' } },
  },
  {
    name: 'ghost',
    normal: {
      rows: ['..BBB..', '.BBBBB.', 'BBEBEBB', 'BPBBBPB', 'BBBBBBB', 'B.B.B.B'],
      alt: { 5: '.B.B.B.' },
    },
    mini: { rows: ['.BBB.', 'BEBEB', 'PBBBP', 'B.B.B'], alt: { 3: '.B.B.' } },
  },
  {
    name: 'frog',
    normal: {
      rows: ['.B...B.', 'BEB.BEB', 'BBBBBBB', 'BPBBBPB', '.BBBBB.', 'BB...BB'],
      alt: { 5: '.BB.BB.' },
    },
    mini: { rows: ['BB.BB', 'EBBBE', 'BBBBB', 'PBBBP'], alt: { 0: 'B...B' } },
  },
  {
    name: 'chick',
    normal: {
      rows: ['...B...', '..BBB..', '.BEBEB.', '.PBOBP.', '.BBBBB.', '..O.O..'],
      alt: { 5: '.O...O.' },
    },
    mini: { rows: ['..B..', '.BBB.', 'BEBEB', 'PBOBP'], alt: { 0: '.B...' } },
  },
  {
    name: 'robot',
    normal: {
      rows: ['...O...', '.BBBBB.', '.BWBWB.', '.PBBBP.', 'DBBBBBD', '.D...D.'],
      alt: { 0: '...L...', 5: '..D.D..' },
    },
    mini: { rows: ['..O..', 'BBBBB', 'BWBWB', 'PBBBP'], alt: { 0: '..L..' } },
  },
  {
    name: 'bunny',
    normal: {
      rows: ['..B.B..', '..B.B..', '.BBBBB.', '.BEBEB.', '.PBBBP.', '..BBB..'],
      alt: { 0: '.B...B.' },
    },
    mini: { rows: ['.B.B.', 'BBBBB', 'BEBEB', 'PBBBP'], alt: { 0: 'B...B' } },
  },
  {
    name: 'octopus',
    normal: {
      rows: ['..BBB..', '.BLBBB.', '.BEBEB.', '.PBBBP.', 'BBBBBBB', 'BB.B.BB'],
      alt: { 5: '.B.B.B.' },
    },
    mini: { rows: ['.BBB.', 'BEBEB', 'PBBBP', '.B.B.'], alt: { 3: 'B.B.B' } },
  },
]

// The first eight match the sprites above (pink blob, orange cat, lavender
// ghost, green frog, yellow chick, blue robot, coral bunny, teal octopus);
// later seats keep cycling sprites with the extra colors.
const COLORS = [
  0xff6fae, 0xffa94d, 0xb197fc, 0x8ce99a, 0xffe066, 0x74c0fc, 0xff8787, 0x63e6be,
  0xf783ac, 0x91a7ff, 0xc0eb75, 0x66d9e8, 0xe599f7,
]

/** A figure's size in pixels, the sprite's offset inside it, and its body radius for collisions. */
export const FIGURES: Record<Size, { w: number; h: number; spriteX: number; radius: number }> = {
  normal: { w: 9, h: 8, spriteX: 1, radius: 4.5 },
  mini: { w: 5, h: 6, spriteX: 0, radius: 3 },
}

const EMPTY_SEGMENT = 0x5c5f66
const SPARKLE_A = 0xfff3bf
const SPARKLE_B = 0xffffff

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const
const pack = (r: number, g: number, b: number) => (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)

export const shade = (c: number, k: number) => {
  const [r, g, b] = rgb(c)
  return pack(r * k, g * k, b * k)
}

const mix = (a: number, b: number, t: number) => {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return pack(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

const gray = (c: number) => {
  const [r, g, b] = rgb(c)
  const y = (0.3 * r + 0.59 * g + 0.11 * b) * 0.7
  return pack(y, y, y)
}

export const buddyColor = (seat: number): number => COLORS[seat % COLORS.length] ?? 0xff6fae

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

export const spriteName = (seat: number): string => SPRITES[seat % SPRITES.length]?.name ?? 'blob'

// How fast a todo-less agent's bar fills: tool calls to reach ~63%. Explore
// agents finish in fewer calls than general ones.
const HALF_LIFE: Record<string, number> = { Explore: 8, Plan: 10, demo: 5 }

/**
 * How far along an agent is, 0 to 1. From its own todo list when it keeps
 * one (TodoWrite, or TaskCreate/TaskUpdate), else an estimate from its tool
 * calls that never claims more than 75% before the agent finishes.
 */
export const fraction = (b: Buddy): number => {
  if (b.status === 'done') return 1
  if (b.todoTotal > 0) return Math.min(b.todoDone / b.todoTotal, 0.95)
  const k = HALF_LIFE[b.type] ?? 14
  return Math.min(1 - Math.exp(-b.calls / k), 0.75)
}

/**
 * Lit segments of the 5-segment bar: the first lights when the agent starts,
 * each next one per 25% done, and the fifth only once it has finished.
 */
export const litSegments = (b: Buddy): number => {
  if (b.status === 'done') return 5
  return 1 + Math.min(3, Math.floor(fraction(b) * 4))
}

const segmentColors = (b: Buddy, frame: number): number[] => {
  const main = b.status === 'failed' ? 0x868e96 : buddyColor(b.seat)
  const lit = litSegments(b)
  const isPulseOn = Math.floor(frame / 4) % 2 === 0
  return [0, 1, 2, 3, 4].map(i => {
    if (i < lit) return main
    if (i === lit && b.status === 'running' && isPulseOn) return shade(main, 0.55)
    return EMPTY_SEGMENT
  })
}

export type Figure = { w: number; h: number; px: (number | null)[][] }

/**
 * One buddy's figure for this frame: bar, air, sprite. A moving buddy
 * alternates its walking frame; eyes blink now and then; a finished buddy
 * sparkles; a failed one is grey with its eyes shut.
 */
export const figure = (b: Buddy, frame: number, size: Size, isMoving: boolean): Figure => {
  const { w, h, spriteX } = FIGURES[size]
  const px: (number | null)[][] = Array.from({ length: h }, () => Array<number | null>(w).fill(null))
  segmentColors(b, frame).forEach((color, i) => {
    const x = size === 'normal' ? i * 2 : i
    px[0]![x] = color
  })
  const frames = (SPRITES[b.seat % SPRITES.length] ?? SPRITES[0]!)[size]
  const main = buddyColor(b.seat)
  const isStepping = isMoving && Math.floor(frame / 3 + b.seat) % 2 === 1
  const isBlinking =
    b.status === 'waiting' || b.status === 'failed' || (frame + b.seat * 11) % 37 < 2
  const palette: Record<string, number> = {
    B: main,
    D: shade(main, 0.62),
    L: mix(main, 0xffffff, 0.55),
    E: 0x2b1b30,
    W: 0xffffff,
    P: mix(main, 0xff3d7f, 0.55),
    O: 0xff922b,
  }
  if (isBlinking) {
    palette.E = palette.D!
    palette.W = palette.D!
  }
  frames.rows.forEach((row, r) => {
    const line = isStepping ? (frames.alt[r] ?? row) : row
    ;[...line].forEach((ch, c) => {
      if (ch === '.') return
      const color = palette[ch] ?? main
      px[r + 2]![c + spriteX] = b.status === 'failed' ? gray(color) : color
    })
  })
  if (b.status === 'done') {
    const spots = Math.floor(frame / 3) % 2 === 0 ? [[1, 0], [3, w - 1]] : [[1, w - 1], [4, 0]]
    for (const [r, c] of spots) {
      if (px[r!]![c!] === null) px[r!]![c!] = Math.floor(frame / 6) % 2 === 0 ? SPARKLE_A : SPARKLE_B
    }
  }
  return { w, h, px }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}
