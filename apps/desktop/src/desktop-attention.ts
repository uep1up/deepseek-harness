/** Native completion notifications and the unread badge, owned by the Electron main process. */
import { app, Notification, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { DesktopAttentionKind, DesktopAttentionNotice } from './ipc.ts'
import type { DesktopLocale } from './locale.ts'

export type { DesktopAttentionKind, DesktopAttentionNotice } from './ipc.ts'

/** Maximum renderer-supplied title length, in UTF-16 code units. */
export const ATTENTION_TITLE_MAX_LENGTH = 200

/** Shell-owned collaborators and platform seams. */
export interface DesktopAttentionOptions {
  /** Current Desktop dictionary; read per notification so a locale change applies immediately. */
  readonly locale: () => DesktopLocale
  /** Primary window; absent before creation or after destruction. */
  readonly window: () => BrowserWindow | undefined
  /** Windows taskbar overlay bitmap carrying the unread dot. */
  readonly overlayIconPath: string
  /** Reveal the application and open one Session after a notification click. */
  readonly activate: (sessionId: string) => void
  /** Operating system whose badge convention applies. */
  readonly platform?: NodeJS.Platform
}

/**
 * Normalize one renderer-supplied notice at the IPC boundary.
 * @param value - untrusted IPC payload.
 * @returns The accepted notice, or undefined when the payload is not usable.
 */
export function desktopAttentionNotice(value: unknown): DesktopAttentionNotice | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const { sessionId, title, kind } = row
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) return undefined
  if (typeof title !== 'string' || title.trim().length === 0) return undefined
  if (kind !== 'turn-complete' && kind !== 'turn-error' && kind !== 'waiting' && kind !== 'job-complete') {
    return undefined
  }
  return {
    sessionId,
    title: title.slice(0, ATTENTION_TITLE_MAX_LENGTH),
    kind,
  }
}

function kindLabel(kind: DesktopAttentionKind, locale: DesktopLocale): string {
  const { messages } = locale
  switch (kind) {
    case 'turn-complete': return messages.attentionTurnComplete
    case 'turn-error': return messages.attentionTurnError
    case 'waiting': return messages.attentionWaiting
    case 'job-complete': return messages.attentionJobComplete
  }
}

/**
 * Owns native completion reminders and the application badge.
 *
 * Notifications appear only while the user is away from the application; the
 * renderer never decides visibility. The badge is a count of sessions the user
 * has not reopened, applied with each platform's own convention.
 */
export class DesktopAttention {
  private badgeCount = 0
  private overlayIcon: NativeImage | undefined
  private readonly open = new Map<string, Notification>()

  /** @param options - Dictionary, window, activation callback, and platform seam. */
  constructor(private readonly options: DesktopAttentionOptions) {}

  /**
   * Show one native reminder for a completed background activity.
   * @param notice - accepted notice; the caller has already validated the payload.
   * @returns whether a notification was actually shown.
   */
  notify(notice: DesktopAttentionNotice): boolean {
    if (!this.shouldNotify()) return false
    const label = kindLabel(notice.kind, this.options.locale())
    this.close(notice.sessionId)
    try {
      if (!Notification.isSupported()) return false
      const notification = new Notification({ title: label, body: notice.title })
      this.open.set(notice.sessionId, notification)
      notification.on('click', () => {
        this.close(notice.sessionId)
        this.options.activate(notice.sessionId)
      })
      notification.on('close', () => { this.close(notice.sessionId) })
      notification.on('failed', () => { this.close(notice.sessionId) })
      notification.show()
      return true
    } catch (error) {
      console.warn('desktop attention: notification unavailable', error)
      this.close(notice.sessionId)
      return false
    }
  }

  /**
   * Apply the unread count with the platform's badge convention.
   * @param count - unread Sessions; non-finite or negative values become zero.
   */
  setBadge(count: number): void {
    const next = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
    this.badgeCount = next
    try {
      const platform = this.options.platform ?? process.platform
      if (platform === 'win32') {
        this.applyWindowsOverlay(next)
        return
      }
      app.setBadgeCount(next)
    } catch (error) { console.warn('desktop attention: badge unavailable', error) }
  }

  /** Reapply the current badge, for example after the primary window was rebuilt. */
  reapply(): void { this.setBadge(this.badgeCount) }

  /** Close every owned notification; called when the shell quits or the renderer reloads. */
  dispose(): void {
    for (const sessionId of [...this.open.keys()]) this.close(sessionId)
  }

  private shouldNotify(): boolean {
    const window = this.options.window()
    if (window === undefined || window.isDestroyed()) return false
    if (!window.isVisible()) return true
    if (!window.isFocused()) return true
    try { return app.isHidden() } catch { return false /* A platform without app hiding is simply focused. */ }
  }

  private applyWindowsOverlay(count: number): void {
    const window = this.options.window()
    if (window === undefined || window.isDestroyed()) return
    if (count === 0) {
      window.setOverlayIcon(null, '')
      return
    }
    this.overlayIcon ??= nativeImage.createFromPath(this.options.overlayIconPath)
    if (this.overlayIcon.isEmpty()) return
    window.setOverlayIcon(this.overlayIcon, this.options.locale().messages.attentionUnreadBadge)
  }

  private close(sessionId: string): void {
    const notification = this.open.get(sessionId)
    if (notification === undefined) return
    this.open.delete(sessionId)
    try {
      notification.removeAllListeners()
      notification.close()
    } catch (error) { console.warn('desktop attention: could not close notification', error) }
  }
}
