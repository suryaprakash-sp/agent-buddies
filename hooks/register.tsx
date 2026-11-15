import { atom, read, update } from 'claude-code'
import type {
  AgentStatus,
  BoxProps,
  ElementConstructor,
  EngineInterface,
  Register,
  RenderElement,
  RenderNode,
  RenderViewport,
  TextProps,
  ToolCallInput,
} from 'claude-code'

import type { Buddy, BuddyStatus } from '../types'
import { roomCells, roomPixels, roomSvg, starsFor, stepRoom, syncBodies } from './room'
import type { Body, Star } from './room'
import { FIGURES, buddyColor, fraction, hex } from './sprites'
import type { Size } from './sprites'

const buddies = atom({ plugin: 'agent-buddies', key: 'buddies' } as const, [])
const isMuted = atom({ plugin: 'agent-buddies', key: 'isMuted' } as const, false)

/** The room shows while at least this many agents are running, and only then. */
const MIN_AGENTS = 3
/** A finished buddy's victory lap before it leaves the room. */
const DONE_STAY_MS = 10000
/** Once nothing runs, the batch's finished agents are forgotten after this long. */
const LINGER_MS = 10000
/** Ten frames a second for the room; tracking chores every fifth frame. */
const FRAME_MS = 100
const CHORES_EVERY = 5
/** The most of the screen the room may take: the bottom-right corner. */
const MAX_WIDTH_SHARE = 0.35
const MAX_HEIGHT_SHARE = 0.45
/** Border top and bottom plus the header row; the border sideways. */
const CHROME_ROWS = 3
const CHROME_COLS = 2
/** The buddies' size; `normal` (7 x 6 sprites) is the larger set. */
const SIZE: Size = 'mini'
/** Bounding-box pixels each figure takes, and how full the room may get before buddies hide. */
const FOOTPRINT: Record<Size, number> = { normal: 72, mini: 30 }
const DENSITY = 0.6
/** Name length on the hover card. */
const NAME_CHARS = 14
const BORDER = '#c99bf0'
const ROOM_KEY = 'room'

const DEMO_LABELS = [
  'Explore schemas',
  'Write loader tests',
  'Review the PR',
  'Scrape docs site',
  'Parse the PDFs',
  'Fix the parser',
  'Check DB load',
  'Build dashboard',
  'Audit ad spend',
  'Sync CRM leads',
  'Load the CSVs',
  'Tune cron jobs',
]

let tick = 0
let frame = 0
let isBusy = false
let isPainting = false
/** Where each buddy is in the room; physics lives here, not in $.state, so frames never redraw the band. */
const bodies = new Map<string, Body>()
/** The room as last drawn on the terminal, for the frame loop to repaint. */
let room:
  | { requestId: string; cols: number; rows: number; size: Size; byId: Map<string, Buddy>; stars: Star[] }
  | undefined
/** Who was in the room at the last draw, so a buddy leaving asks for a redraw. */
let drawnIds = ''
/** Loops no agent row names (compaction and memory forks): never tracked. */
const ignored = new Set<string>()

const isActive = (b: Buddy) => b.status === 'running' || b.status === 'waiting'
const bySeat = (a: Buddy, b: Buddy) => a.seat - b.seat
/** Working agents first, the furthest along of them first; finished ones after. */
const byPriority = (a: Buddy, b: Buddy) =>
  Number(isActive(b)) - Number(isActive(a)) || fraction(b) - fraction(a) || a.seat - b.seat

/**
 * Which buddies are kept and whether the room shows: it shows exactly while
 * MIN_AGENTS or more are running. A batch's finished agents all stay counted
 * as done for as long as any of it runs, however long ago they finished (a
 * workflow's 12 of 19 reads 12 done), and are forgotten LINGER_MS after the
 * last one ends. Returns `list` itself when nothing was dropped.
 */
export const settle = (list: Buddy[], now: number) => {
  const active = list.filter(isActive).length
  const kept = active > 0 ? list : list.filter(b => b.endedAt !== null && now - b.endedAt < LINGER_MS)
  return { list: kept.length === list.length ? list : kept, isShowing: active >= MIN_AGENTS }
}

/** Who is in the room: everyone still working, and finished ones on their victory lap. */
export const inRoom = (list: Buddy[], now: number) =>
  list.filter(b => isActive(b) || (b.endedAt !== null && now - b.endedAt < DONE_STAY_MS))

const refresh = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const list = await read($, buddies)
  if (settle(list, now).list !== list) await update($, buddies, cur => settle(cur, now).list)
}

const addBuddy = async ($: EngineInterface, id: string, label: string, type: string, isDemo: boolean) => {
  await update($, buddies, list => {
    if (list.some(b => b.id === id)) return list
    const taken = new Set(list.map(b => b.seat))
    let seat = 0
    while (taken.has(seat)) seat += 1
    const buddy: Buddy = {
      id,
      label: label.trim() || type,
      type,
      seat,
      calls: 0,
      todoDone: 0,
      todoTotal: 0,
      doneTaskIds: [],
      status: 'running',
      endedAt: null,
      isDemo,
    }
    return [...list, buddy]
  })
  await refresh($)
}

/** One tool call of an agent's loop: a step further, and its todos if any. */
export const bump = (b: Buddy, e: ToolCallInput): Buddy => {
  const next: Buddy = { ...b, calls: b.calls + 1, status: 'running', endedAt: null }
  if (e.tool === 'TodoWrite') {
    next.todoTotal = e.todos.length
    next.todoDone = e.todos.filter(todo => todo.status === 'completed').length
  } else if (e.tool === 'TaskCreate') {
    next.todoTotal += 1
  } else if (e.tool === 'TaskUpdate') {
    if (e.status === 'completed' && !b.doneTaskIds.includes(e.taskId)) {
      next.todoDone += 1
      next.doneTaskIds = [...b.doneTaskIds, e.taskId]
    } else if (e.status === 'deleted') {
      next.todoTotal = Math.max(0, next.todoTotal - 1)
    }
  }
  return next
}

const noteCall = async ($: EngineInterface, agentId: string, e: ToolCallInput) => {
  const list = await read($, buddies)
  if (!list.some(b => b.id === agentId)) {
    if (ignored.has(agentId)) return
    const info = (await $.agent.list()).find(agent => agent.id === agentId)
    if (info === undefined) {
      ignored.add(agentId)
      return
    }
    await addBuddy($, agentId, info.description, info.type, false)
  }
  await update($, buddies, cur => cur.map(b => (b.id === agentId ? bump(b, e) : b)))
}

const finish = async ($: EngineInterface, agentId: string, status: BuddyStatus) => {
  const now = await $.clock.now()
  await update($, buddies, list =>
    list.map(b => (b.id === agentId && isActive(b) ? { ...b, status, endedAt: now } : b)),
  )
  await refresh($)
}

const statusOf = (status: AgentStatus): BuddyStatus => {
  if (status === 'completed' || status === 'idle') return 'done'
  if (status === 'failed' || status === 'killed') return 'failed'
  if (status === 'waiting') return 'waiting'
  return 'running'
}

/** Catches agents that ended without a turn.complete (killed, failed). */
const reconcile = async ($: EngineInterface) => {
  const list = await read($, buddies)
  if (!list.some(b => !b.isDemo && isActive(b))) return
  const byId = new Map((await $.agent.list()).map(agent => [agent.id, agent]))
  const changed = (b: Buddy) => {
    const info = byId.get(b.id)
    return info !== undefined && !b.isDemo && isActive(b) && statusOf(info.status) !== b.status
  }
  if (!list.some(changed)) return
  const now = await $.clock.now()
  await update($, buddies, cur =>
    cur.map(b => {
      if (!changed(b)) return b
      const status = statusOf(byId.get(b.id)!.status)
      return { ...b, status, endedAt: isActive({ ...b, status }) ? null : now }
    }),
  )
}

const startDemo = async ($: EngineInterface, count: number) => {
  await update($, isMuted, () => false)
  await update($, buddies, list => list.filter(b => !b.isDemo))
  for (let i = 0; i < count; i += 1) {
    const round = Math.floor(i / DEMO_LABELS.length)
    const label = `${DEMO_LABELS[i % DEMO_LABELS.length]}${round > 0 ? ` ${round + 1}` : ''}`
    await addBuddy($, `demo-${i + 1}`, label, i === 0 ? 'Explore' : 'demo', true)
  }
}

/** Demo buddies take a step every third chore tick and finish at staggered times. */
const advanceDemo = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, buddies, list =>
    list.map((b): Buddy => {
      if (!b.isDemo || b.status !== 'running' || (tick + b.seat) % 3 !== 0) return b
      const calls = b.calls + 1
      const target = 6 + ((b.seat * 7) % 11)
      return calls >= target ? { ...b, calls, status: 'done', endedAt: now } : { ...b, calls }
    }),
  )
}

/** Tracking chores, twice a second: the demo, missed endings, the latch, buddies leaving. */
const chores = async ($: EngineInterface) => {
  if (isBusy) return
  isBusy = true
  try {
    tick += 1
    const list = await read($, buddies)
    if (list.length === 0) return
    if (list.some(b => b.isDemo && b.status === 'running')) await advanceDemo($)
    if (tick % 4 === 0) await reconcile($)
    await refresh($)
    if (room !== undefined) {
      const ids = inRoom(await read($, buddies), await $.clock.now()).map(b => b.id).join(',')
      if (ids !== drawnIds) $.ui.invalidate('ui.render')
    }
  } catch {
    // A missed chore is fine; the next tick tries again.
  } finally {
    isBusy = false
  }
}

/** One frame: move everyone and repaint the room's Raster in place, with no redraw. */
const paint = async ($: EngineInterface) => {
  const current = room
  if (current === undefined || isPainting) return
  isPainting = true
  try {
    const { requestId, cols, rows, size, byId, stars } = current
    stepRoom(bodies, byId, cols, rows * 2, size, Math.random)
    const px = roomPixels(bodies, byId, cols, rows, size, frame, stars)
    await $.ui.blit({ requestId, key: ROOM_KEY, cells: roomCells(px, cols, rows) })
  } catch {
    // Not mounted this instant (collapsed, redrawing): the next frame tries again.
  } finally {
    isPainting = false
  }
}

type Summary = { active: number; done: number; failed: number; pct: number }

const summarize = (list: Buddy[]): Summary => ({
  active: list.filter(isActive).length,
  done: list.filter(b => b.status === 'done').length,
  failed: list.filter(b => b.status === 'failed').length,
  pct: Math.round((list.reduce((sum, b) => sum + fraction(b), 0) / Math.max(1, list.length)) * 100),
})

const headerText = (s: Summary, hidden: number) =>
  `✿ ${s.active} working · ${s.done} done${s.failed > 0 ? ` · ${s.failed} failed` : ''} · ${s.pct}%` +
  (hidden > 0 ? ` · +${hidden} hidden` : '')

type Layout =
  | { mode: 'room'; size: Size; shown: Buddy[]; hidden: Buddy[]; cols: number; rows: number }
  | { mode: 'line' }

/**
 * The room takes the whole corner the person allowed (35% of the width, 45%
 * of the height), so the buddies have space to roam. Past what it holds, the
 * working ones stay (furthest along first) and the rest are hidden.
 */
export const plan = (
  list: Buddy[],
  bodyColumns: number,
  maxRows: number,
  viewport: RenderViewport | undefined,
): Layout => {
  const screenCols = viewport?.columns ?? bodyColumns
  const screenRows = viewport?.rows ?? maxRows * 2
  const cols = Math.min(bodyColumns, Math.floor(screenCols * MAX_WIDTH_SHARE)) - CHROME_COLS
  const rows = Math.min(maxRows, Math.floor(screenRows * MAX_HEIGHT_SHARE)) - CHROME_ROWS
  if (cols < 12 || rows * 2 < FIGURES[SIZE].h + 2) return { mode: 'line' }
  const capacity = Math.max(1, Math.floor((DENSITY * cols * rows * 2) / FOOTPRINT[SIZE]))
  const ranked = [...list].sort(byPriority)
  const shown = ranked.slice(0, capacity).sort(bySeat)
  const hidden = ranked.slice(capacity).sort(bySeat)
  return { mode: 'room', size: SIZE, shown, hidden, cols, rows }
}

const clip = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text)

/**
 * Short names that tell agents apart: words every label opens with (say
 * `Inventory:`) are dropped, other shared words only while two remain, and
 * names that still clip alike show their ends.
 */
export const shortLabels = (labels: string[], width: number): string[] => {
  const words = labels.map(label => label.trim().split(/\s+/))
  let skip = 0
  const first = words[0] ?? []
  if (labels.length > 1) {
    // A shared tag ending in a colon (`Inventory:`) always goes; other shared words go while two remain.
    const canDrop = (w: string[]) => {
      const left = w.length - (skip + 1)
      return w[skip] === first[skip] && (left >= 2 || (left >= 1 && (first[skip] ?? '').endsWith(':')))
    }
    while (words.every(canDrop)) skip += 1
  }
  const bare = words.map(w => w.slice(skip).join(' '))
  const heads = bare.map(text => clip(text, width))
  return heads.map((head, i) => {
    const text = bare[i]!
    const isAmbiguous = heads.filter(other => other === head).length > 1 && text.length > width
    return isAmbiguous ? `…${text.slice(-(width - 1))}` : head
  })
}

type NameItem = { text: string; color: string }

/**
 * The hover card's names, packed into lines of `width`: the room's buddies in
 * their colors, then the hidden ones dimmed; the last line ends in `+n` when
 * they run out of room.
 */
export const nameLines = (shown: Buddy[], hidden: Buddy[], width: number, maxLines: number): NameItem[][] => {
  const all = [...shown, ...hidden]
  const names = shortLabels(all.map(b => b.label), NAME_CHARS)
  const items: NameItem[] = all.map((b, i) => {
    if (i >= shown.length) return { text: `(${names[i]})`, color: 'subtle' }
    if (b.status === 'done') return { text: `✓ ${names[i]}`, color: 'success' }
    if (b.status === 'failed') return { text: `✗ ${names[i]}`, color: 'error' }
    return { text: names[i]!, color: hex(buddyColor(b.seat)) }
  })
  const lines: NameItem[][] = [[]]
  let used = 0
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!
    const need = (used > 0 ? 2 : 0) + item.text.length
    if (used + need <= width) {
      lines.at(-1)!.push(item)
      used += need
      continue
    }
    if (lines.length >= maxLines) {
      const last = lines.at(-1)!
      let rest = items.length - i
      const width_ = () => last.reduce((sum, it, j) => sum + it.text.length + (j > 0 ? 2 : 0), 0)
      while (last.length > 0 && width_() + 2 + `+${rest}`.length > width) {
        last.pop()
        rest += 1
      }
      last.push({ text: `+${rest}`, color: 'subtle' })
      return lines
    }
    lines.push([item])
    used = item.text.length
  }
  return lines
}

const drawRoom = (
  Box: ElementConstructor<BoxProps>,
  Text: ElementConstructor<TextProps>,
  picture: RenderNode,
  s: Summary,
  layout: Extract<Layout, { mode: 'room' }>,
  width: number,
): RenderElement => (
  <Box width={width} flexDirection="row" justifyContent="flex-end">
    <Box key="buddies-room" flexDirection="column" borderStyle="round" borderColor={BORDER} width={layout.cols + CHROME_COLS}>
      <Text wrap="truncate-end">
        <Text color="#ff8cc6">✿ </Text>
        <Text bold>{s.active}</Text>
        <Text dimColor> working · </Text>
        <Text bold color="success">
          {s.done}
        </Text>
        <Text dimColor> done</Text>
        {s.failed > 0 && <Text color="error"> · {s.failed} failed</Text>}
        <Text dimColor> · </Text>
        <Text bold color="#ffd43b">
          {s.pct}%
        </Text>
        {layout.hidden.length > 0 && <Text dimColor> · +{layout.hidden.length} hidden</Text>}
      </Text>
      {picture}
      <Box position="absolute" top={1} left={0} display="none" hover={{ display: 'flex' }} flexDirection="column">
        {nameLines(layout.shown, layout.hidden, layout.cols, layout.rows).map(line => (
          <Text wrap="truncate-end">
            {line.map((item, j) => (
              <Text color={item.color}>
                {j > 0 ? '  ' : ''}
                {item.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    </Box>
  </Box>
)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'buddies',
      description: 'Agent buddies room: demo [n] plays a preview, off hides it, on shows it again, clear empties it',
      argumentHint: '[demo [n]|on|off|clear]',
    })
    $.clock.every(FRAME_MS, () => {
      frame += 1
      if (frame % CHORES_EVERY === 0) void chores($)
      void paint($)
    })

    return next(e)
  })

  on('command.run', { command: 'buddies' }, async ($, e) => {
    const [word = '', count = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'demo') {
      const n = Math.max(MIN_AGENTS, Math.min(40, Number.parseInt(count, 10) || 5))
      await startDemo($, n)
      return { text: `Playing a ${n}-agent preview in the bottom-right corner.` }
    }
    if (word === 'off') {
      await update($, isMuted, () => true)
      return { text: 'Hidden. /buddies on brings it back.' }
    }
    if (word === 'on') {
      await update($, isMuted, () => false)
      return { text: `On. The room opens once ${MIN_AGENTS} or more agents run at once.` }
    }
    if (word === 'clear') {
      await update($, buddies, () => [])
      return { text: 'Cleared.' }
    }
    const list = await read($, buddies)
    const muted = await read($, isMuted)
    return {
      text: `${muted ? 'Hidden' : 'On'}, ${list.filter(isActive).length} agents running. Opens at ${MIN_AGENTS}+ agents. Try /buddies demo 12.`,
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) {
      try {
        await addBuddy($, started.agentId, e.description, e.subagentType, false)
      } catch {
        // Tracking is cosmetic: never stand in the spawn's way.
      }
    }
    return started
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      try {
        await noteCall($, e.agentId, e)
      } catch {
        // As above: the call goes on whatever the tracking does.
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      try {
        await finish($, e.agentId, e.reason === 'answer' ? 'done' : 'failed')
      } catch {
        // As above.
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, buddies)
    const muted = await read($, isMuted)
    const now = await $.clock.now()
    const candidates = inRoom(list, now)
    drawnIds = candidates.map(b => b.id).join(',')
    if (muted || !settle(list, now).isShowing || candidates.length === 0) {
      room = undefined
      return next(e)
    }
    const layout = plan(candidates, e.props.bodyColumns, e.props.maxRows, e.viewport)
    const s = summarize(list)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (layout.mode === 'line') {
      room = undefined
      return (
        <Box width={e.props.bodyColumns} flexDirection="row" justifyContent="flex-end">
          <Text color={BORDER} wrap="truncate-end">
            {headerText(s, 0)}
          </Text>
        </Box>
      )
    }
    const { cols, rows, size } = layout
    syncBodies(bodies, layout.shown, cols, rows * 2, size, Math.random)
    const byId = new Map(layout.shown.map(b => [b.id, b]))
    const stars = starsFor(cols, rows)
    const px = roomPixels(bodies, byId, cols, rows, size, frame, stars)

    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      room = { requestId: e.requestId, cols, rows, size, byId, stars }
      const picture = <Raster key={ROOM_KEY} columns={cols} rows={rows} cells={roomCells(px, cols, rows)} />
      return drawRoom(Box, Text, picture, s, layout, e.props.bodyColumns)
    }
    const { Svg } = $.ui.resolve(e)
    room = undefined
    const alt = `${s.active} agents working, ${s.pct}% overall`
    const picture = <Svg source={roomSvg(px, cols, rows)} alt={alt} width={cols * 8} height={rows * 16} />
    return drawRoom(Box, Text, picture, s, layout, e.props.bodyColumns)
  })
}
