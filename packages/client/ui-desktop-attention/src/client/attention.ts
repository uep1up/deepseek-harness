/**
 * Desktop completion attention, framework-free core: it watches the Session
 * status, list, error, and background-job sources, reports each new completion
 * to the Electron shell, and keeps the unread badge count in step.
 *
 * The shell owns presentation and focus: it decides whether a notification is
 * actually shown and returns that decision, so a count is only added to the
 * badge for activity the user could not see.
 */

/** One Session row fact the controller reads; the Session Controller row supplies these. */
export interface AttentionSessionRow {
  readonly displayTitle: string
  /** Coarse durable origin; subagent rows never own user-facing attention. */
  readonly origin?: 'subagent' | undefined
  readonly running: boolean
  readonly retainedBy: Readonly<{ mainView?: number | undefined }>
}

/** Session catalog shape read by the controller. */
export interface AttentionListSnapshot {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, AttentionSessionRow>>
}

/** Per-Session UI status facts supplied by `ctx.uiSession.sessionStatus`. */
export interface AttentionSessionStatus {
  readonly running: boolean | undefined
  /** Highest-precedence request awaiting user interaction; presence means "waiting". */
  readonly pendingInteraction: unknown
}

/** Session UI status indexed by Session identity. */
export type AttentionStatusSnapshot = ReadonlyMap<string, AttentionSessionStatus>

/** One background-job row fact read from the jobs snapshot. */
export interface AttentionJobRow {
  readonly id: string
  readonly owner?: string | undefined
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
}

/** Background-job roster shape read by the controller. */
export interface AttentionJobsSnapshot {
  readonly rows: Readonly<Record<string, readonly AttentionJobRow[]>>
}

/** Retained completion-attention preferences. */
export interface AttentionPreferences {
  readonly notifications: boolean
  readonly badge: boolean
}

/** Attention reasons reported to the shell. */
export type AttentionKind = 'turn-complete' | 'turn-error' | 'waiting' | 'job-complete'

/** One notice crossing the desktop bridge. */
export interface AttentionNotice {
  readonly sessionId: string
  readonly title: string
  readonly kind: AttentionKind
}

/** Native shell operations the controller drives. */
export interface AttentionBridge {
  /** @returns whether a notification was actually shown. */
  notify(notice: AttentionNotice): Promise<boolean>
  setBadge(count: number): Promise<void>
  read(): Promise<AttentionPreferences>
  update(update: Partial<AttentionPreferences>): Promise<AttentionPreferences>
  onActivate(listener: (sessionId: string) => void): () => void
}

/** Read-only observable snapshot consumed by the controller. */
export interface AttentionSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Client sources the controller observes. */
export interface AttentionSources {
  readonly status: AttentionSource<AttentionStatusSnapshot>
  readonly list: AttentionSource<AttentionListSnapshot>
  readonly jobs: {
    readonly state: AttentionSource<AttentionJobsSnapshot>
    watchRows(sessionId: string): () => void
  }
  /** @returns unsubscribe for the Host Agent error stream. */
  subscribeErrors(listener: (sessionId: string) => void): () => void
  /** Open one Session in the main view after a notification click. */
  openSession(sessionId: string): void
}

/** Controller inputs. */
export interface AttentionControllerOptions {
  readonly bridge: AttentionBridge
  readonly sources: AttentionSources
  /** Clock used to suppress a completion that immediately follows its error. */
  readonly now?: () => number
}

/** A completion reported within this window after an error is the same activity. */
const ERROR_SUPPRESSION_MS = 5_000

/** Bridges owned by the controller until disposal. */
export class DesktopAttentionController {
  private preferences: AttentionPreferences = { notifications: true, badge: true }
  private readonly unread = new Set<string>()
  private readonly statuses = new Map<string, { running: boolean | undefined; waiting: boolean }>()
  private readonly errorAt = new Map<string, number>()
  private readonly jobStatus = new Map<string, AttentionJobRow['status']>()
  private readonly watches = new Map<string, () => void>()
  private readonly disposers: (() => void)[] = []
  private started = false
  private disposed = false

  /** @param options - bridge, observed sources, and clock seam. */
  constructor(private readonly options: AttentionControllerOptions) {}

  /** Read preferences and begin observing every source. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const { bridge, sources } = this.options
    try { this.preferences = await bridge.read() } catch { /* A missing document keeps the enabled defaults. */ }
    if (this.disposed) return
    this.disposers.push(bridge.onActivate((sessionId) => {
      this.unread.delete(sessionId)
      this.publishBadge()
      sources.openSession(sessionId)
    }))
    this.disposers.push(sources.subscribeErrors((sessionId) => { this.error(sessionId) }))
    this.disposers.push(sources.status.subscribe(() => { this.statusChanged() }))
    this.disposers.push(sources.list.subscribe(() => { this.listChanged() }))
    this.disposers.push(sources.jobs.state.subscribe(() => { this.jobsChanged() }))
    this.statusChanged()
    this.listChanged()
    this.jobsChanged()
  }

  /** Release every subscription and pending row watch. */
  dispose(): void {
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) dispose()
    for (const stop of this.watches.values()) stop()
    this.watches.clear()
    this.started = false
  }

  /**
   * Read the preferences last accepted from the shell.
   * @returns the current accepted preferences.
   */
  getPreferences(): AttentionPreferences { return this.preferences }

  /**
   * Persist one preference change and apply it immediately.
   * @param update - members to replace.
   * @returns the accepted preferences.
   */
  async updatePreferences(update: Partial<AttentionPreferences>): Promise<AttentionPreferences> {
    this.preferences = await this.options.bridge.update(update)
    this.publishBadge()
    return this.preferences
  }

  private statusChanged(): void {
    const snapshot = this.options.sources.status.getSnapshot()
    for (const [sessionId, status] of snapshot) {
      const previous = this.statuses.get(sessionId)
      const waiting = status.pendingInteraction !== undefined
      if (waiting && previous?.waiting !== true) this.notify('waiting', sessionId)
      if (previous?.running === true && status.running === false) this.completed(sessionId)
      this.statuses.set(sessionId, { running: status.running, waiting })
    }
    for (const sessionId of this.statuses.keys()) {
      if (!snapshot.has(sessionId)) this.statuses.delete(sessionId)
    }
  }

  private completed(sessionId: string): void {
    const erroredAt = this.errorAt.get(sessionId)
    if (erroredAt !== undefined && this.now() - erroredAt < ERROR_SUPPRESSION_MS) return
    this.notify('turn-complete', sessionId)
  }

  private error(sessionId: string): void {
    this.errorAt.set(sessionId, this.now())
    this.notify('turn-error', sessionId)
  }

  private listChanged(): void {
    const snapshot = this.options.sources.list.getSnapshot()
    const present = new Set(snapshot.ids)
    for (const [sessionId, row] of Object.entries(snapshot.byId)) {
      if ((row.retainedBy.mainView ?? 0) > 0) this.unread.delete(sessionId)
    }
    for (const sessionId of [...this.unread]) {
      if (!present.has(sessionId)) this.unread.delete(sessionId)
    }
    for (const sessionId of [...this.watches.keys()]) {
      if (!present.has(sessionId)) this.releaseWatch(sessionId)
    }
    this.reconcileWatches()
    this.publishBadge()
  }

  private jobsChanged(): void {
    const snapshot = this.options.sources.jobs.state.getSnapshot()
    for (const rows of Object.values(snapshot.rows)) {
      for (const row of rows) this.observeJob(row)
    }
    this.reconcileWatches()
  }

  private observeJob(row: AttentionJobRow): void {
    const key = `${row.owner ?? ''}/${row.id}`
    const previous = this.jobStatus.get(key)
    this.jobStatus.set(key, row.status)
    if (previous !== 'running' && previous !== 'stopping') return
    if (row.status !== 'completed' && row.status !== 'failed') return
    if (row.owner === undefined) return
    this.notify('job-complete', row.owner, row.label)
  }

  private reconcileWatches(): void {
    const list = this.options.sources.list.getSnapshot()
    for (const sessionId of list.ids) {
      const row = list.byId[sessionId]
      if (row === undefined || row.origin === 'subagent' || !row.running) continue
      if (!this.watches.has(sessionId)) {
        this.watches.set(sessionId, this.options.sources.jobs.watchRows(sessionId))
      }
    }
    // A watch outlives its turn: a roster baseline that has not arrived yet is
    // also indistinguishable from an empty roster, so listChanged releases a
    // watch only once the Session leaves the catalog.
  }

  private releaseWatch(sessionId: string): void {
    const stop = this.watches.get(sessionId)
    this.watches.delete(sessionId)
    stop?.()
  }

  private notify(kind: AttentionKind, sessionId: string, title?: string): void {
    if (this.disposed || !this.preferences.notifications) return
    const row = this.options.sources.list.getSnapshot().byId[sessionId]
    if (row?.origin === 'subagent') return
    const body = title ?? row?.displayTitle
    if (body === undefined || body === '') return
    void this.options.bridge.notify({ sessionId, title: body, kind })
      .then((shown) => {
        if (!shown) return
        this.unread.add(sessionId)
        this.publishBadge()
      })
      .catch(() => { /* A shell without native notifications never blocks the client. */ })
  }

  private publishBadge(): void {
    void this.options.bridge.setBadge(this.preferences.badge ? this.unread.size : 0)
      .catch(() => { /* Badge failures are presentation-only. */ })
  }

  private now(): number { return (this.options.now ?? Date.now)() }
}
