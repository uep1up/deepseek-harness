/**
 * Local Electron shell settings, loaded once per process independently of the Host.
 * Ownership: .agents/notes/implemented/architecture/2026-10-08-desktop-shell-configuration.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Resolved shell preferences; absent fields use the defaults without rewriting existing files. */
export interface DesktopSettings {
  readonly updates: {
    readonly allowTestAuthPopupWindow: boolean
  }
  /** Completion attention for the native shell: notifications and the unread badge. */
  readonly attention: DesktopAttentionPreference
}

/** Completion attention preferences; absent values default to enabled. */
export interface DesktopAttentionPreference {
  readonly notifications: boolean
  readonly badge: boolean
}

/** One accepted preference update; omitted members keep their stored value. */
export interface DesktopAttentionUpdate {
  readonly notifications?: boolean
  readonly badge?: boolean
}

const ATTENTION_DEFAULTS: DesktopAttentionPreference = { notifications: true, badge: true }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function settingsPath(userData: string): string {
  return join(userData, 'desktop', 'settings.json')
}

function attentionOf(value: unknown): DesktopAttentionPreference {
  if (value === undefined) return ATTENTION_DEFAULTS
  if (!record(value)) throw new Error('attention must be an object')
  const notifications = value.notifications
  const badge = value.badge
  if (notifications !== undefined && typeof notifications !== 'boolean') {
    throw new Error('attention.notifications must be true or false')
  }
  if (badge !== undefined && typeof badge !== 'boolean') throw new Error('attention.badge must be true or false')
  return { notifications: notifications ?? true, badge: badge ?? true }
}

function parseSettings(raw: string): DesktopSettings {
  const value: unknown = JSON.parse(raw)
  if (!record(value) || (value.updates !== undefined && !record(value.updates))) {
    throw new Error('expected a JSON object with an optional updates object')
  }
  const allow = value.updates?.allowTestAuthPopupWindow
  if (allow !== undefined && typeof allow !== 'boolean') {
    throw new Error('updates.allowTestAuthPopupWindow must be true or false')
  }
  return {
    updates: { allowTestAuthPopupWindow: allow ?? false },
    attention: attentionOf(value.attention),
  }
}

/**
 * Read shell settings, creating the default document exclusively when missing.
 * @param userData - Electron's userData directory, independent of DSH_HOME.
 * @returns Validated settings, or defaults when reading, creating or validating fails; changes require a restart.
 */
export function readDesktopSettings(userData: string): DesktopSettings {
  const path = settingsPath(userData)
  const defaults: DesktopSettings = {
    updates: { allowTestAuthPopupWindow: false },
    attention: ATTENTION_DEFAULTS,
  }
  try {
    let raw: string
    try { raw = readFileSync(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      mkdirSync(join(userData, 'desktop'), { recursive: true, mode: 0o700 })
      try { writeFileSync(path, `${JSON.stringify(defaults, null, 2)}\n`, { flag: 'wx', mode: 0o600 }) } catch (error) {
        // An existing document belongs to the user, including one created during initialization.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      raw = readFileSync(path, 'utf8')
    }
    return parseSettings(raw)
  } catch (error) {
    try {
      console.warn(`desktop settings: ${path}: using defaults because settings could not be loaded`, error)
    } catch (_logError) {
      // Diagnostic output is best effort; its failure must not make optional settings fatal.
      // TODO: Persist settings diagnostics when console output is unavailable, without blocking startup.
    }
    return defaults
  }
}

/**
 * Merge one completion-attention preference update into the stored document.
 * @param userData - Electron's userData directory.
 * @param update - accepted members to replace; omitted members keep their value.
 * @returns The complete preference after the write.
 * @throws when the document is unreadable or cannot be written; a missing document is created first.
 */
export function updateDesktopAttention(userData: string, update: DesktopAttentionUpdate): DesktopAttentionPreference {
  const document = readDesktopSettings(userData)
  const attention: DesktopAttentionPreference = {
    ...document.attention,
    ...(update.notifications === undefined ? {} : { notifications: update.notifications }),
    ...(update.badge === undefined ? {} : { badge: update.badge }),
  }
  const path = settingsPath(userData)
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!record(parsed)) throw new Error('expected a JSON object')
    stored = parsed
  } catch (error) {
    // A missing document is created above; anything else stays untouched so the user can repair it.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  stored.attention = attention
  // Unknown fields belong to the user; only the attention branch is replaced.
  mkdirSync(join(userData, 'desktop'), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  return attention
}
