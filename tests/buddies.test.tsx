import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Buddy } from '../types'
import { bump, inRoom, nameLines, plan, settle, shortLabels } from '../hooks/register'
import { roomPixels, stepRoom, syncBodies } from '../hooks/room'
import type { Body } from '../hooks/room'
import { FIGURES, figure, fraction, litSegments } from '../hooks/sprites'

const buddy = (over: Partial<Buddy> = {}): Buddy => ({
  id: 'a',
  label: 'Explore auth',
  type: 'general-purpose',
  seat: 0,
  calls: 0,
  todoDone: 0,
  todoTotal: 0,
  doneTaskIds: [],
  status: 'running',
  endedAt: null,
  isDemo: false,
  ...over,
})

const crowd = (running: number, done: number, endedAt = 1000): Buddy[] => [
  ...Array.from({ length: done }, (_, i) =>
    buddy({ id: `d${i}`, seat: i, label: `Inventory: done ${i}`, status: 'done', endedAt }),
  ),
  ...Array.from({ length: running }, (_, i) =>
    buddy({ id: `r${i}`, seat: done + i, label: `Inventory: running ${i}`, calls: i }),
  ),
]

/** A seeded generator, so physics runs repeat exactly. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// The person's terminal: 168 x 44, the band offered 22 rows.
const VIEWPORT = { columns: 168, rows: 44 }
const BAND = {
  plugin: 'agent-buddies',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 22,
    bodyColumns: 163,
    scroll: { offset: 0, bodyRows: 21 },
    view: {},
  },
  viewport: VIEWPORT,
} as const
const ROOM_COLS = Math.floor(168 * 0.35) - 2
const ROOM_ROWS = Math.floor(44 * 0.45) - 3

const engineBottom = (on: On) => {
  let n = 0
  mock.clock(on, { now: 1000 })
  on('agent.spawn', () => ({ model: 'test-model', agentId: `agent-${(n += 1)}` }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
}

const spawnInput = (description: string) => ({
  tool_use_id: `toolu_${description.replace(/\W/g, '_')}`,
  prompt: `Do ${description}`,
  description,
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'test-model',
  background: true,
  fork: false,
})

const complete = (agentId: string) => ({
  answer: 'ok',
  durationMs: 5,
  isAborted: false,
  turnId: `t-${agentId}`,
  agentId,
  reason: 'answer' as const,
})

describe('progress bar', () => {
  test('5 segments: start, then one per 25%, the last only when done', async () => {
    expect(litSegments(buddy())).toBe(1)
    expect(litSegments(buddy({ todoTotal: 4, todoDone: 1 }))).toBe(2)
    expect(litSegments(buddy({ todoTotal: 4, todoDone: 2 }))).toBe(3)
    expect(litSegments(buddy({ todoTotal: 4, todoDone: 3 }))).toBe(4)
    expect(litSegments(buddy({ todoTotal: 4, todoDone: 4 }))).toBe(4)
    expect(litSegments(buddy({ status: 'done' }))).toBe(5)
  })

  test('without todos the estimate never passes 75% before the agent ends', async () => {
    expect(fraction(buddy({ calls: 500 }))).toBe(0.75)
    expect(litSegments(buddy({ calls: 500 }))).toBe(4)
  })

  test('TodoWrite and TaskUpdate move the bar', async () => {
    const todos = [
      { content: 'a', status: 'completed', activeForm: 'a' },
      { content: 'b', status: 'in_progress', activeForm: 'b' },
    ] as const
    const after = bump(buddy(), { tool: 'TodoWrite', tool_use_id: 't1', agentId: 'a', todos: [...todos] })
    expect([after.todoDone, after.todoTotal, after.calls]).toEqual([1, 2, 1])
    const created = bump(buddy(), { tool: 'TaskCreate', tool_use_id: 't2', agentId: 'a', subject: 's', description: 'd' })
    const doneOnce = bump(created, { tool: 'TaskUpdate', tool_use_id: 't3', agentId: 'a', taskId: '7', status: 'completed' })
    const doneTwice = bump(doneOnce, { tool: 'TaskUpdate', tool_use_id: 't4', agentId: 'a', taskId: '7', status: 'completed' })
    expect([doneTwice.todoDone, doneTwice.todoTotal]).toEqual([1, 1])
  })

  test('the bar sits on top of the figure with the lit count in the buddy color', async () => {
    const fig = figure(buddy({ todoTotal: 4, todoDone: 2 }), 1, 'mini', false)
    expect(fig.px[0]!.filter(c => c === 0xff6fae)).toHaveLength(3)
    expect(fig.px[1]!.every(c => c === null)).toBe(true)
  })
})

describe('when the room shows', () => {
  test('only while 3 or more agents are running', async () => {
    expect(settle(crowd(2, 0), 2000).isShowing).toBe(false)
    expect(settle(crowd(3, 0), 2000).isShowing).toBe(true)
    expect(settle(crowd(1, 18), 2000).isShowing).toBe(false)
    expect(settle(crowd(2, 9), 2000).isShowing).toBe(false)
    expect(settle(crowd(3, 8), 2000).isShowing).toBe(true)
  })

  test('finished ones count as done while others run, and are forgotten after the last ends', async () => {
    expect(settle(crowd(1, 5), 60000).list).toHaveLength(6)
    // A long workflow: finished 25 minutes ago, still counted while the batch runs.
    expect(settle(crowd(7, 12), 25 * 60 * 1000).list).toHaveLength(19)
    expect(settle(crowd(0, 5), 5000).list).toHaveLength(5)
    expect(settle(crowd(0, 5), 12000).list).toHaveLength(0)
  })

  test('a finished buddy takes a 10 second victory lap, then leaves the room', async () => {
    const list = crowd(3, 2, 1000)
    expect(inRoom(list, 5000)).toHaveLength(5)
    expect(inRoom(list, 11500)).toHaveLength(3)
  })
})

describe('the room', () => {
  test('takes the whole corner: 35% of the width, 45% of the height', async () => {
    const layout = plan(crowd(3, 0), 163, 22, VIEWPORT)
    if (layout.mode !== 'room') throw new Error('expected a room')
    expect([layout.cols, layout.rows]).toEqual([ROOM_COLS, ROOM_ROWS])
    expect(layout.size).toBe('mini')
    expect(layout.shown).toHaveLength(3)
    expect(layout.hidden).toHaveLength(0)
  })

  test('never hides a running agent while a finished one is shown', async () => {
    // A small terminal, so the room cannot hold all eleven.
    const layout = plan(crowd(3, 8), 60, 30, { columns: 60, rows: 30 })
    if (layout.mode !== 'room') throw new Error('expected a room')
    expect(layout.hidden.length).toBeGreaterThan(0)
    expect(layout.shown.filter(b => b.status === 'running')).toHaveLength(3)
    expect(layout.hidden.every(b => b.status === 'done')).toBe(true)
  })

  test('falls back to one line when the corner is too small for a room', async () => {
    expect(plan(crowd(3, 0), 30, 6, { columns: 30, rows: 8 }).mode).toBe('line')
  })
})

describe('names', () => {
  test('drop the words every label opens with, and show the ends of names that clip alike', async () => {
    const names = shortLabels(
      [
        'Inventory: sample-webapp git + docs',
        'Inventory: sample-webapp sessions 1',
        'Inventory: sample-webapp sessions 2',
        'Inventory: saved analytics transcripts',
      ],
      14,
    )
    expect(names).toEqual(['…pp git + docs', '…pp sessions 1', '…pp sessions 2', 'saved analyti…'])
    expect(names.every(n => n.length <= 14)).toBe(true)
    expect(shortLabels(['Inventory: part 9', 'Inventory: part 10'], 14)).toEqual(['part 9', 'part 10'])
    expect(shortLabels(['Inventory: one', 'Inventory: three'], 14)).toEqual(['one', 'three'])
    expect(shortLabels(['Fix bug A', 'Fix bug B'], 14)).toEqual(['bug A', 'bug B'])
  })

  test('the hover card lists the room, then the hidden ones dimmed, and ends with +n past its lines', async () => {
    const shown = crowd(3, 0)
    const hidden = [buddy({ id: 'h', seat: 9, label: 'Inventory: hidden one', status: 'done', endedAt: 1 })]
    const lines = nameLines(shown, hidden, 60, 3)
    const items = lines.flat()
    expect(items.map(i => i.text)).toEqual(['running 0', 'running 1', 'running 2', '(hidden one)'])
    expect(items.at(-1)?.color).toBe('subtle')
    const many = Array.from({ length: 12 }, (_, i) => buddy({ id: `m${i}`, seat: i, label: `agent${i}-wanders-about` }))
    const tight = nameLines(many, [], 24, 2).flat()
    expect(tight.at(-1)?.text).toMatch(/^\+\d+$/)
  })
})

describe('physics', () => {
  const run = (count: number, frames: number, seed: number) => {
    const list = crowd(count, 0)
    const byId = new Map(list.map(b => [b.id, b]))
    const bodies = new Map<string, Body>()
    const rng = seeded(seed)
    const w = ROOM_COLS
    const h = ROOM_ROWS * 2
    syncBodies(bodies, list, w, h, 'mini', rng)
    const fig = FIGURES.mini
    let outside = 0
    let overlaps = 0
    const start = [...bodies.values()].map(b => ({ x: b.x, y: b.y }))
    for (let f = 0; f < frames; f += 1) {
      stepRoom(bodies, byId, w, h, 'mini', rng)
      const all = [...bodies.values()]
      for (const b of all) {
        const x0 = Math.round(b.x - fig.w / 2)
        const y0 = Math.round(b.y - fig.h / 2) - 1
        if (x0 < 0 || x0 + fig.w > w || y0 < 0 || Math.round(b.y - fig.h / 2) + fig.h > h) outside += 1
        if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) outside += 1000
      }
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          if (Math.hypot(all[i]!.x - all[j]!.x, all[i]!.y - all[j]!.y) < fig.radius * 2 - 0.5) overlaps += 1
        }
      }
    }
    const moved = [...bodies.values()].map((b, i) => Math.hypot(b.x - start[i]!.x, b.y - start[i]!.y))
    return { bodies, outside, overlaps, moved, byId, w, h }
  }

  test('every buddy stays fully inside the walls, hop included, over 2000 frames', async () => {
    for (const seed of [1, 2, 3]) expect(run(8, 2000, seed).outside).toBe(0)
    expect(run(30, 1000, 4).outside).toBe(0)
  })

  test('buddies keep moving and wander off where they started', async () => {
    const { bodies, moved } = run(5, 600, 7)
    expect([...bodies.values()].every(b => Math.hypot(b.vx, b.vy) >= 0.35 - 1e-9)).toBe(true)
    expect(moved.every(d => d > 3)).toBe(true)
  })

  test('collisions push buddies apart: overlaps are rare and shallow', async () => {
    const { overlaps } = run(8, 2000, 11)
    expect(overlaps).toBeLessThan(2000 * 0.02)
  })

  test('the room draws every figure whole, never clipped', async () => {
    const { bodies, byId, w, h } = run(8, 300, 5)
    const px = roomPixels(bodies, byId, w, h / 2, 'mini', 3, [])
    const drawn = px.flat().filter(c => c !== null).length
    const expected = [...byId.values()].reduce((sum, b) => {
      const body = bodies.get(b.id)!
      const fig = figure(b, 3, 'mini', Math.hypot(body.vx, body.vy) > 0.05)
      return sum + fig.px.flat().filter(c => c !== null).length
    }, 0)
    expect(drawn).toBe(expected)
  })
})

describe('in the engine', () => {
  test('2 agents: nothing; 3: the full-size room; back to 2: gone', async ($, on) => {
    engineBottom(on)
    await $.agent.spawn(spawnInput('Inventory: one'))
    await $.agent.spawn(spawnInput('Inventory: two'))
    const quiet = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await quiet.findAll({ type: 'Raster' })).toHaveLength(0)
    await quiet.unmount()

    await $.agent.spawn(spawnInput('Inventory: three'))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      if (surface === 'terminal') {
        const rooms = await ui.findAll({ type: 'Raster' })
        expect(rooms).toHaveLength(1)
        expect([rooms[0]!.props.columns, rooms[0]!.props.rows]).toEqual([ROOM_COLS, ROOM_ROWS])
      } else {
        expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
      }
      expect((await ui.find({ type: 'Text', text: /working/ }))?.text).toContain('3 working')
      expect(await ui.find({ type: 'Text', text: /^\s*three$/ })).toBeDefined()
      await ui.unmount()
    }

    await $.turn.complete(complete('agent-1'))
    const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await after.findAll({ type: 'Raster' })).toHaveLength(0)
    expect(await after.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await after.unmount()
  })

  test('11 agents with 8 finished: the 3 still running are in the room, counted right', async ($, on) => {
    engineBottom(on)
    for (let i = 1; i <= 11; i += 1) await $.agent.spawn(spawnInput(`Inventory: part ${i}`))
    for (let i = 1; i <= 8; i += 1) await $.turn.complete(complete(`agent-${i}`))
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const header = (await ui.find({ type: 'Text', text: /working/ }))?.text ?? ''
    expect(header).toContain('3 working')
    expect(header).toContain('8 done')
    expect(header).not.toContain('hidden')
    for (const n of [9, 10, 11]) expect(await ui.find({ type: 'Text', text: new RegExp(`^\\s*part ${n}$`) })).toBeDefined()
    await ui.unmount()
  })

  test('a 19-agent workflow, 12 finished over 12 minutes: the header keeps saying 12 done', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    let n = 0
    on('agent.spawn', () => ({ model: 'test-model', agentId: `agent-${(n += 1)}` }))
    on('agent.list', () => ({ value: [] }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine band</Text>
    })
    for (let i = 1; i <= 19; i += 1) await $.agent.spawn(spawnInput(`Research ${i}`))
    for (let i = 1; i <= 12; i += 1) {
      await $.turn.complete(complete(`agent-${i}`))
      await clock.advance(60 * 1000)
    }
    await clock.advance(5 * 60 * 1000)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const header = (await ui.find({ type: 'Text', text: /working/ }))?.text ?? ''
    expect(header).toContain('7 working')
    expect(header).toContain('12 done')
    await ui.unmount()
  })

  test('/buddies demo 25 starts 25 demo buddies', async ($, on) => {
    engineBottom(on)
    const ran = await $.command.run({
      command: 'buddies',
      args: 'demo 25',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 168 },
    })
    expect(ran.text).toContain('25-agent')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /working/ }))?.text).toContain('25 working')
    await ui.unmount()
  })
})
