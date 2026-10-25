/**
 * Desktop completion attention, browser half: reports finished replies, Agent
 * errors, pending confirmations, and settled background jobs to the Electron
 * shell, and offers the two General Settings preferences. The shell shows the
 * notification and badge; this plugin only names the activity.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DesktopAttentionController,
  type AttentionBridge,
  type AttentionJobsSnapshot,
  type AttentionListSnapshot,
  type AttentionPreferences,
  type AttentionSessionStatus,
  type AttentionSource,
  type AttentionStatusSnapshot,
} from './attention.ts'
import { currentDesktopAttention } from './bridge.ts'
import { AttentionSettingsRow, type AttentionSettingsRowInjected } from './AttentionSettingsRow.tsx'
import { en, NS, zh, type DesktopAttentionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop completion-attention preferences. */
    'desktop.attention': DesktopAttentionKey
  }
}

export type { AttentionSettingsRowInjected } from './AttentionSettingsRow.tsx'

/** Required services: Session status and catalog, background jobs, errors, navigation, slots, and copy. */
export const inject = ['sessions', 'uiSession', 'uiWorkspace', 'jobs', 'remote', 'slots', 'locale']

/** Mutable observable for the two stored preferences. */
function preferenceSource(controller: DesktopAttentionController): {
  source: AttentionSource<AttentionPreferences>
  publish(): void
} {
  let current = controller.getPreferences()
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    publish: () => {
      current = controller.getPreferences()
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Client plugin body: install the controller and the General Settings rows in
 * the Desktop shell, and do nothing in a browser.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const bridge: AttentionBridge | undefined = currentDesktopAttention()
  if (bridge === undefined) return
  const status: AttentionSource<AttentionStatusSnapshot> = {
    getSnapshot: () => {
      const snapshot = new Map<string, AttentionSessionStatus>()
      for (const [sessionId, value] of ctx.uiSession.sessionStatus.getSnapshot()) {
        snapshot.set(sessionId, { running: value.running, pendingInteraction: value.pendingInteraction })
      }
      return snapshot
    },
    subscribe: listener => ctx.uiSession.sessionStatus.subscribe(listener),
  }
  const list: AttentionSource<AttentionListSnapshot> = {
    getSnapshot: () => {
      const value = ctx.sessions.list.getSnapshot()
      const byId: Record<string, AttentionListSnapshot['byId'][string]> = {}
      for (const [sessionId, row] of Object.entries(value.byId)) {
        byId[sessionId] = {
          displayTitle: row.displayTitle,
          origin: row.origin,
          running: row.running,
          retainedBy: { mainView: row.retainedBy.mainView },
        }
      }
      return { ids: value.ids, byId }
    },
    subscribe: listener => ctx.sessions.list.subscribe(listener),
  }
  const jobs: AttentionSource<AttentionJobsSnapshot> = {
    getSnapshot: () => {
      const value = ctx.jobs.state.getSnapshot()
      const rows: Record<string, AttentionJobsSnapshot['rows'][string]> = {}
      for (const [sessionId, entries] of Object.entries(value.rows)) {
        rows[sessionId] = entries.map(entry => ({
          id: entry.id,
          owner: entry.owner,
          label: entry.label,
          status: entry.status,
        }))
      }
      return { rows }
    },
    subscribe: listener => ctx.jobs.state.subscribe(listener),
  }
  const controller = new DesktopAttentionController({
    bridge,
    sources: {
      status,
      list,
      jobs: { state: jobs, watchRows: sessionId => ctx.jobs.watchRows(SessionId(sessionId)) },
      subscribeErrors: listener => ctx.remote.$on('api-session/error', (sessionId) => { listener(sessionId) }),
      openSession: (sessionId) => { ctx.uiWorkspace.openSession(SessionId(sessionId)) },
    },
  })
  ctx.effect(() => () => { controller.dispose() }, 'ui-desktop-attention: controller')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-attention: dictionaries')
  const preferences = preferenceSource(controller)
  void controller.start().then(() => { preferences.publish() }).catch(() => { preferences.publish() })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-attention',
    order: 20,
    locale: NS,
    inject: (): AttentionSettingsRowInjected => ({
      hooks: { attention: preferences.source },
      setNotifications: async (enabled) => {
        await controller.updatePreferences({ notifications: enabled })
        preferences.publish()
      },
      setBadge: async (enabled) => {
        await controller.updatePreferences({ badge: enabled })
        preferences.publish()
      },
    }),
  }, AttentionSettingsRow))
}
