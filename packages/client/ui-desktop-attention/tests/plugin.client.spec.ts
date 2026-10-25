/**
 * Browser-half composition over the real SlotRegistry and LocaleRuntime: the
 * Settings row registers beside the Desktop bridge, a completion reaches the
 * native shell, the injected writers persist preferences, and fiber teardown
 * removes the row and every subscription.
 */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AttentionBridge, AttentionListSnapshot, AttentionNotice, AttentionPreferences } from '../src/client/attention.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, NS } from '../src/client/locales.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Observable status map with subscription bookkeeping for teardown assertions. */
class StatusSource {
  private listeners = new Set<() => void>()
  private value = new Map<string, { running: boolean | undefined; pendingInteraction: unknown }>()
  getSnapshot() { return this.value }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: Map<string, { running: boolean | undefined; pendingInteraction: unknown }>): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  get size(): number { return this.listeners.size }
}

interface Bench {
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  status: StatusSource
  list: ReturnType<typeof createSnapshotStore<SessionListState>>
  jobs: ReturnType<typeof createSnapshotStore<{ rows: Record<string, readonly { id: string; owner?: string; label: string; status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed' }[]> }>>
  bridge: AttentionBridge
  notices: AttentionNotice[]
  badges: number[]
  opened: string[]
  updates: Partial<AttentionPreferences>[]
  errors: ((sessionId: string) => void)[]
  activate(sessionId: string): void
}

async function bench(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  const list = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  const status = new StatusSource()
  const jobs = createSnapshotStore<{ rows: Record<string, readonly { id: string; owner?: string; label: string; status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed' }[]> }>({ rows: {} })
  const notices: AttentionNotice[] = []
  const badges: number[] = []
  const opened: string[] = []
  const updates: Partial<AttentionPreferences>[] = []
  const errors: ((sessionId: string) => void)[] = []
  let reads = 0
  let preferences: AttentionPreferences = { notifications: true, badge: true }
  const activations = new Set<(sessionId: string) => void>()
  const bridge: AttentionBridge = {
    notify: vi.fn(async (notice: AttentionNotice) => { notices.push(notice); return true }),
    setBadge: vi.fn(async (count: number) => { badges.push(count) }),
    read: vi.fn(async () => { reads += 1; return preferences }),
    update: vi.fn(async (update: Partial<AttentionPreferences>) => {
      updates.push(update)
      preferences = { ...preferences, ...update }
      return preferences
    }),
    onActivate: vi.fn((listener: (sessionId: string) => void) => {
      activations.add(listener)
      return () => { activations.delete(listener) }
    }),
  }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, attention: bridge })
  ctx.provide('sessions', { list })
  ctx.provide('uiSession', { sessionStatus: status })
  ctx.provide('jobs', { state: jobs, watchRows: () => () => {} })
  ctx.provide('uiWorkspace', { openSession: (sessionId: string) => { opened.push(sessionId) } })
  ctx.provide('remote', {
    $on: (method: string, listener: (sessionId: string) => void) => {
      if (method !== 'api-session/error') return () => {}
      errors.push(listener)
      return () => { errors.splice(errors.indexOf(listener), 1) }
    },
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  await vi.waitFor(() => { expect(reads).toBeGreaterThan(0) })
  // Let start()'s continuation publish the loaded preferences before the test reads them.
  await new Promise(resolve => setTimeout(resolve, 0))
  return {
    ctx, fiber, status, list, jobs, bridge, notices, badges, opened, updates, errors,
    activate: (sessionId) => { for (const listener of activations) listener(sessionId) },
  }
}

describe('Desktop attention browser half', () => {
  it('registers the General Settings row and its dictionary in the Desktop shell only', async () => {
    const f = await bench()
    const entries = f.ctx.slots.entries('settings.general.item')
    expect(entries.map(entry => entry.options.id)).toEqual(['desktop-attention'])
    expect(entries[0]?.locale).toBe(NS)
    expect(f.ctx.locale.bind(NS)('title')).toBe(en.title)
    await f.fiber.dispose()
    await f.fiber.await()
    expect(f.ctx.slots.entries('settings.general.item')).toHaveLength(0)
    expect(f.status.size).toBe(0)
    expect(f.errors).toHaveLength(0)
  })

  it('reports a finished turn with the session title and paints the unread badge', async () => {
    const f = await bench()
    f.list.set({ ids: ['s-1'], byId: { 's-1': { id: 's-1', displayTitle: 'Write the report', running: true, retainedBy: {}, updatedAt: 0, blank: false } } } as never)
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => {
      expect(f.notices).toEqual([{ sessionId: 's-1', title: 'Write the report', kind: 'turn-complete' }])
    })
    await vi.waitFor(() => { expect(f.badges.at(-1)).toBe(1) })
  })

  it('persists the injected preference writers and stops notifying when disabled', async () => {
    const f = await bench()
    const entry = f.ctx.slots.entries('settings.general.item')[0]
    const injected = entry?.inject?.() as {
      setNotifications(enabled: boolean): Promise<void>
      setBadge(enabled: boolean): Promise<void>
    }
    await injected.setNotifications(false)
    await injected.setBadge(false)
    expect(f.updates).toEqual([{ notifications: false }, { badge: false }])
    f.list.set({ ids: ['s-1'], byId: { 's-1': { id: 's-1', displayTitle: 'Title', running: true, retainedBy: {}, updatedAt: 0, blank: false } } } as never)
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await Promise.resolve()
    expect(f.notices).toEqual([])
    expect(f.badges.at(-1)).toBe(0)
  })

  it('opens the Session named by a notification activation', async () => {
    const f = await bench()
    f.list.set({ ids: ['s-1'], byId: { 's-1': { id: 's-1', displayTitle: 'Title', running: true, retainedBy: {}, updatedAt: 0, blank: false } } } as never)
    f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
    f.status.set(new Map([['s-1', { running: false, pendingInteraction: undefined }]]))
    await vi.waitFor(() => { expect(f.notices).toHaveLength(1) })
    f.activate('s-1')
    expect(f.opened).toEqual(['s-1'])
    expect(f.badges.at(-1)).toBe(0)
  })

  it('contributes nothing in a browser without the bridge', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry)
    ctx.slots.register({ name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
    ctx.provide('sessions', { list: createSnapshotStore<AttentionListSnapshot>({ ids: [], byId: {} }) })
    ctx.provide('uiSession', { sessionStatus: new StatusSource() })
    ctx.provide('jobs', { state: createSnapshotStore({ rows: {} }), watchRows: () => () => {} })
    ctx.provide('uiWorkspace', { openSession: () => {} })
    ctx.provide('remote', { $on: () => () => {} })
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    expect(ctx.slots.entries('settings.general.item')).toHaveLength(0)
  })
})

it('publishes preference changes to the injected subscribers', async () => {
  const f = await bench()
  const injected = f.ctx.slots.entries('settings.general.item')[0]?.inject?.() as {
    hooks: { attention: { getSnapshot(): AttentionPreferences; subscribe(listener: () => void): () => void } }
    setNotifications(enabled: boolean): Promise<void>
    setBadge(enabled: boolean): Promise<void>
  }
  const source = injected.hooks.attention
  const seen: AttentionPreferences[] = []
  const stop = source.subscribe(() => { seen.push(source.getSnapshot()) })
  await injected.setNotifications(false)
  expect(seen).toEqual([{ notifications: false, badge: true }])
  stop()
  await injected.setBadge(false)
  expect(seen).toHaveLength(1)
  expect(source.getSnapshot()).toEqual({ notifications: false, badge: false })
})

it('reports a settled job through the jobs adapter', async () => {
  const f = await bench()
  f.list.set({ ids: ['s-1'], byId: { 's-1': { id: 's-1', displayTitle: 'Title', running: true, retainedBy: {}, updatedAt: 0, blank: false } } } as never)
  f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: 'Build', status: 'running' }] } })
  f.jobs.set({ rows: { 's-1': [{ id: 'job-1', owner: 's-1', label: 'Build', status: 'completed' }] } })
  await vi.waitFor(() => { expect(f.notices.at(-1)).toEqual({ sessionId: 's-1', title: 'Build', kind: 'job-complete' }) })
})

it('reports an Agent error through the remote listener', async () => {
  const f = await bench()
  f.list.set({ ids: ['s-1'], byId: { 's-1': { id: 's-1', displayTitle: 'Title', running: true, retainedBy: {}, updatedAt: 0, blank: false } } } as never)
  f.status.set(new Map([['s-1', { running: true, pendingInteraction: undefined }]]))
  for (const listener of f.errors) listener('s-1')
  await vi.waitFor(() => { expect(f.notices.at(-1)).toEqual({ sessionId: 's-1', title: 'Title', kind: 'turn-error' }) })
})

it('still registers the row when starting the controller fails', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  const failing: AttentionBridge = {
    notify: async () => true,
    setBadge: async () => {},
    read: async () => ({ notifications: true, badge: true }),
    update: async () => ({ notifications: true, badge: true }),
    onActivate: () => { throw new Error('no activation channel') },
  }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, attention: failing })
  ctx.provide('sessions', { list: createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }) })
  ctx.provide('uiSession', { sessionStatus: new StatusSource() })
  ctx.provide('jobs', { state: createSnapshotStore({ rows: {} }), watchRows: () => () => {} })
  ctx.provide('uiWorkspace', { openSession: () => {} })
  ctx.provide('remote', { $on: () => () => {} })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(ctx.slots.entries('settings.general.item')).toHaveLength(1)
})
