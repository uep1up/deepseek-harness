// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import type { AttentionPreferences } from '../src/client/attention.ts'
import { AttentionSettingsRow } from '../src/client/AttentionSettingsRow.tsx'
import { en } from '../src/client/locales.ts'
import { desktopAttentionBridge } from '../src/client/bridge.ts'

afterEach(() => { cleanup() })

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never

// Global standard kit stubs: this component consumes none of these hooks.
const unusedHook = (() => { throw new Error('unused by the Desktop attention row') }) as never
const kit = {
  useSessions: unusedHook,
  useSessionStatus: unusedHook,
  usePanelInfo: unusedHook,
  useSessionRetainInfo: () => undefined,
  useResource: unusedHook,
  useWorkspaces: unusedHook,
  ...allowAllAccess,
}

function renderRow(options: {
  preferences?: AttentionPreferences
  setNotifications?: (enabled: boolean) => Promise<void>
  setBadge?: (enabled: boolean) => Promise<void>
  useAttention?: (selector: (value: AttentionPreferences) => unknown) => unknown
} = {}) {
  const preferences = options.preferences ?? { notifications: true, badge: true }
  const setNotifications = options.setNotifications ?? vi.fn(async () => {})
  const setBadge = options.setBadge ?? vi.fn(async () => {})
  const useAttention = options.useAttention ?? ((selector: (value: AttentionPreferences) => unknown) => selector(preferences))
  render(<AttentionSettingsRow
    {...kit}
    t={t}
    useAttention={useAttention as never}
    setNotifications={setNotifications}
    setBadge={setBadge}
  />)
  return { setNotifications, setBadge }
}

it('renders both preferences and writes the requested state', async () => {
  const { setNotifications, setBadge } = renderRow()
  expect(screen.getByText('Desktop notifications')).toBeDefined()
  expect(screen.getByText('Unread badge')).toBeDefined()
  const notifications = screen.getByRole('switch', { name: 'Desktop notifications' })
  const badge = screen.getByRole('switch', { name: 'Unread badge' })
  expect(notifications.getAttribute('aria-checked')).toBe('true')
  expect(badge.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(notifications)
  await waitFor(() => { expect(setNotifications).toHaveBeenCalledWith(false) })
  fireEvent.click(badge)
  await waitFor(() => { expect(setBadge).toHaveBeenCalledWith(false) })
})

it('reflects disabled stored preferences', () => {
  renderRow({ preferences: { notifications: false, badge: false } })
  expect(screen.getByRole('switch', { name: 'Desktop notifications' }).getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('switch', { name: 'Unread badge' }).getAttribute('aria-checked')).toBe('false')
})

it('disables both switches while a write is in flight and reports failures', async () => {
  let reject: ((error: Error) => void) | undefined
  const pending = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise })
  renderRow({ setNotifications: () => pending })
  const notifications = screen.getByRole('switch', { name: 'Desktop notifications' })
  fireEvent.click(notifications)
  await waitFor(() => { expect(notifications.hasAttribute('disabled')).toBe(true) })
  expect(screen.getByRole('switch', { name: 'Unread badge' }).hasAttribute('disabled')).toBe(true)
  reject?.(new Error('disk full'))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Could not save. Try again.') })
  expect(notifications.hasAttribute('disabled')).toBe(false)
})

it('detects only a protocol-1 shell carrying the attention bridge', () => {
  const bridge = {
    notify: async () => true,
    setBadge: async () => {},
    read: async () => ({ notifications: true, badge: true }),
    update: async () => ({ notifications: true, badge: true }),
    onActivate: () => () => {},
  }
  expect(desktopAttentionBridge(undefined)).toBeUndefined()
  expect(desktopAttentionBridge({ protocolVersion: 2, attention: bridge })).toBeUndefined()
  expect(desktopAttentionBridge({ protocolVersion: 1 })).toBeUndefined()
  expect(desktopAttentionBridge({ protocolVersion: 1, attention: { notify: () => {} } })).toBeUndefined()
  expect(desktopAttentionBridge({ protocolVersion: 1, attention: bridge })).toBe(bridge)
})
