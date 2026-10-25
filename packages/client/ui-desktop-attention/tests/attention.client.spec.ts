import { describe, expect, it, vi } from 'vitest'
import {
  DesktopAttentionController,
  type AttentionBridge,
  type AttentionJobsSnapshot,
  type AttentionListSnapshot,
  type AttentionNotice,
  type AttentionPreferences,
  type AttentionStatusSnapshot,
  type AttentionSource,
} from '../src/client/attention.ts'

class Source<T> implements AttentionSource<T> {
  private listeners = new Set<() => void>()
  constructor(private value: T) {}
  getSnapshot(): T { return this.value }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  get size(): number { return this.listeners.size }
}

interface Fixture {
  bridge: AttentionBridge
  notified: AttentionNotice[]
  badges: number[]
  status: Source<AttentionStatusSnapshot>
  list: Source<AttentionListSnapshot>
  jobs: Source<AttentionJobsSnapshot>
  watches: Map<string, ReturnType<typeof vi.fn>>
  errors: ((sessionId: string) => void)[]
  opened: string[]
  controller: DesktopAttentionController
  state: { shown: boolean }
  readCalls(): number
  activate(sessionId: string): void
}

function fixture(options: { preferences?: AttentionPreferences; now?: () => number } = {}): Fixture {
  const notified: AttentionNotice[] = []
  const badges: number[] = []
  const watches = new Map<string, ReturnType<typeof vi.fn>>()
  const errors: ((sessionId: string) => void)[] = []
  const opened: string[] = []
  const activations = new Set<(sessionId: string) => void>()
  const state = { shown: true }
  let readCalls = 0
  let preferences: AttentionPreferences = options.preferences ?? { notifications: true, badge: true }
  const bridge: AttentionBridge = {
    notify: vi.fn(async (notice: AttentionNotice) => { notified.push(notice); return state.shown }),
    setBadge: vi.fn(async (count: number) => { badges.push(count) }),
    read: vi.fn(async () => { readCalls += 1; return preferences }),
    update: vi.fn(async (update: Partial<AttentionPreferences>) => {
      preferences = { ...preferences, ...update }
      return preferences
    }),
    onActivate: vi.fn((listener: (sessionId: string) => void) => {
      activations.add(listener)
      return () => { activations.delete(listener) }
    }),
  }
  const status = new Source<AttentionStatusSnapshot>(new Map())
  const list = new Source<AttentionListSnapshot>({ ids: [], byId: {} })
  const jobs = new Source<AttentionJobsSnapshot>({ rows: {} })
  const controller = new DesktopAttentionController({
    bridge,
    ...(options.now === undefined ? {} : { now: options.now }),
    sources: {
      status,
      list,
      jobs: {
        state: jobs,
        watchRows: (sessionId) => {
          const stop = vi.fn(() => { watches.delete(sessionId) })
          watches.set(sessionId, stop)
          return stop
        },
      },
      subscribeErrors: (listener) => {
        errors.push(listener)
        return () => { errors.splice(errors.indexOf(listener), 1) }
      },
      openSession: (sessionId) => { opened.push(sessionId) },
    },
  })
  return {
    bridge, notified, badges, status, list, jobs, watches, errors, opened, controller, state,
    readCalls: () => readCalls,
    activate: (sessionId) => { for (const listener of activations) listener(sessionId) },
  }
}

function row(displayTitle: string, overrides: Partial<AttentionListSnapshot['byId'][string]> = {}) {
  return { displayTitle, running: false, retainedBy: {}, ...overrides }
}

async function started(f = fixture()): Promise<Fixture> {
  await f.controller.start()
  return f
}

describe('DesktopAttentionController', () => {
  it('reports a finished turn with the session title and raises the badge for a shown notice', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Write the report', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.notified).toEqual([{ sessionId: 's-1', title: 'Write the report', kind: 'turn-complete' }]) })
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(1) })
  })

  it('skips notifications and the badge while preferences disable them', async () => {
    const f = await started(fixture({ preferences: { notifications: false, badge: false } }))
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.notified).toEqual([])
    expect(f.badges.at(-1)).toBe(0)
  })

  it('leaves the badge alone when the native shell suppresses the notification', async () => {
    const f = await started()
    f.state.shown = false
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.notified).toHaveLength(1) })
    expect(f.badges).toEqual([0, 0])
  })

  it('never notifies for subagent sessions', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Child', { running: true, origin: 'subagent' }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.notified).toEqual([])
    expect(f.watches.size).toBe(0)
  })

  it('reports an Agent error once and suppresses the completion that follows it', async () => {
    const now = vi.fn(() => 1_000)
    const f = await started(fixture({ now }))
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    for (const listener of f.errors) listener('s-1')
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.notified.map(notice => notice.kind)).toEqual(['turn-error']) })
  })

  it('reports a completion after an older error', async () => {
    let now = 1_000
    const f = await started(fixture({ now: () => now }))
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    for (const listener of f.errors) listener('s-1')
    now = 7_000
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.notified.map(notice => notice.kind)).toEqual(['turn-error', 'turn-complete']) })
  })

  it('reports a pending confirmation only when one starts waiting', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: { key: 'a' } }]]))
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: { key: 'a' } }]]))
    await vi.waitFor(() => { expect(f.notified).toEqual([{ sessionId: 's-1', title: 'Title', kind: 'waiting' }]) })
  })

  it('watches running sessions until they leave the catalog and reports their settled jobs', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    expect(f.watches.has('s-1')).toBe(true)
    f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: 'Build', status: 'running' }] } })
    // The turn ends while the job keeps running; the roster baseline must not be released early.
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: false }) } })
    expect(f.watches.has('s-1')).toBe(true)
    f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: 'Build', status: 'completed' }] } })
    await vi.waitFor(() => { expect(f.notified.at(-1)).toEqual({ sessionId: 's-1', title: 'Build', kind: 'job-complete' }) })
    f.list.set({ ids: [], byId: {} })
    expect(f.watches.has('s-1')).toBe(false)
  })

  it('ignores killed jobs and jobs without an owner session', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: 'Build', status: 'running' }] } })
    f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: 'Build', status: 'killed' }] } })
    f.jobs.set({ rows: { 's-1': [{ id: 'job-2', label: 'Loose', status: 'running' }] } })
    f.jobs.set({ rows: { 's-1': [{ id: 'job-2', label: 'Loose', status: 'failed' }] } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.notified).toEqual([])
  })

  it('opens the clicked session, clears its unread count, and republishes the badge', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(1) })
    f.activate('s-1')
    expect(f.opened).toEqual(['s-1'])
    expect(f.badges.at(-1)).toBe(0)
  })

  it('drops unread rows when the session becomes the main view or leaves the catalog', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1', 's-2'], byId: { 's-1': row('One', { running: true }), 's-2': row('Two', { running: true }) } })
    f.status.set(new Map([
      ['s-1', { running: true, pendingInteraction: undefined }],
      ['s-2', { running: true, pendingInteraction: undefined }],
    ]))
    f.status.set(new Map([
      ['s-1', { running: false, pendingInteraction: undefined }],
      ['s-2', { running: false, pendingInteraction: undefined }],
    ]))
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(2) })
    f.list.set({ ids: ['s-1', 's-2'], byId: { 's-1': row('One', { retainedBy: { mainView: 1 } }), 's-2': row('Two') } })
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(1) })
    f.list.set({ ids: [], byId: {} })
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(0) })
    expect(f.watches.size).toBe(0)
  })

  it('persists preference changes and applies badge visibility immediately', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(1) })
    await f.controller.updatePreferences({ badge: false })
    expect(f.badges.at(-1)).toBe(0)
    expect(f.controller.getPreferences()).toEqual({ notifications: true, badge: false })
    await f.controller.updatePreferences({ notifications: false })
    expect(f.controller.getPreferences()).toEqual({ notifications: false, badge: false })
  })

  it('releases subscriptions, watches, and the activation listener on disposal', async () => {
    const f = await started()
    f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
    expect(f.watches.size).toBe(1)
    const stop = f.watches.get('s-1')
    f.controller.dispose()
    expect(stop).toHaveBeenCalledOnce()
    expect(f.status.size).toBe(0)
    expect(f.list.size).toBe(0)
    expect(f.jobs.size).toBe(0)
    expect(f.errors).toEqual([])
    f.activate('s-1')
    expect(f.opened).toEqual([])
  })

  it('starts once and tolerates a shell that cannot read preferences', async () => {
    const f = fixture()
    let calls = 0
    const failing = { ...f.bridge, read: async () => { calls += 1; throw new Error('no document') } }
    const controller = new DesktopAttentionController({ bridge: failing, sources: { status: f.status, list: f.list,
      jobs: { state: f.jobs, watchRows: () => () => {} }, subscribeErrors: () => () => {}, openSession: () => {} } })
    await controller.start()
    await controller.start()
    expect(calls).toBe(1)
    expect(f.controller.getPreferences()).toEqual({ notifications: true, badge: true })
  })
})

it('keeps quiet for a Session missing from the catalog and for an empty job label', async () => {
  const f = await started()
  // No list row means no display title: the error and its completion report nothing.
  for (const listener of f.errors) listener('ghost')
  f.status.set(new Map([['ghost', { running: true, pendingInteraction: undefined }]]))
  f.status.set(new Map([['ghost', { running: false, pendingInteraction: undefined }]]))
  f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
  f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: '', status: 'running' }] } })
  f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: '', status: 'completed' }] } })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(f.notified).toEqual([])
})

it('drops statuses that leave the snapshot without reporting anything', async () => {
  const f = await started()
  f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
  f.status.set(new Map())
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(f.notified).toEqual([])
})

it('contains a rejecting notification or badge call', async () => {
  const f = await started()
  const notify = vi.fn(async () => { throw new Error('notification unavailable') })
  const setBadge = vi.fn(async () => { throw new Error('badge unavailable') })
  f.bridge.notify = notify
  f.bridge.setBadge = setBadge
  f.list.set({ ids: ['s-1'], byId: { 's-1': row('Title', { running: true }) } })
  f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
  f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
  await vi.waitFor(() => { expect(notify).toHaveBeenCalled() })
  expect(setBadge).toHaveBeenCalled()
  expect(f.badges.at(-1)).toBe(0)
})

it('does not subscribe when disposed while preferences are loading', async () => {
  let resolveRead: ((value: AttentionPreferences) => void) | undefined
  const onActivate = vi.fn(() => () => {})
  const bridge: AttentionBridge = {
    notify: vi.fn(async () => true),
    setBadge: vi.fn(async () => {}),
    read: () => new Promise<AttentionPreferences>((resolve) => { resolveRead = resolve }),
    update: vi.fn(async () => ({ notifications: true, badge: true })),
    onActivate,
  }
  const status = new Source<AttentionStatusSnapshot>(new Map())
  const list = new Source<AttentionListSnapshot>({ ids: [], byId: {} })
  const jobs = new Source<AttentionJobsSnapshot>({ rows: {} })
  const controller = new DesktopAttentionController({
    bridge,
    sources: {
      status,
      list,
      jobs: { state: jobs, watchRows: () => () => {} },
      subscribeErrors: () => () => {},
      openSession: () => {},
    },
  })
  const starting = controller.start()
  controller.dispose()
  resolveRead?.({ notifications: true, badge: true })
  await starting
  expect(onActivate).not.toHaveBeenCalled()
  expect(status.size).toBe(0)
  expect(list.size).toBe(0)
  expect(jobs.size).toBe(0)
})
