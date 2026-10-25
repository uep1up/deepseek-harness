import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { ATTENTION_TITLE_MAX_LENGTH, DesktopAttention, desktopAttentionNotice } from '../src/desktop-attention.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const notices: Notice[] = []
  class Notice extends EventEmitter {
    static isSupported = vi.fn(() => true)
    show = vi.fn()
    close = vi.fn()
    constructor(readonly options: unknown) { super(); notices.push(this) }
  }
  return {
    notices,
    Notice,
    app: { setBadgeCount: vi.fn(() => true), isHidden: vi.fn(() => false) },
    nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => false })) },
  }
})
vi.mock('electron', () => ({ Notification: native.Notice, app: native.app, nativeImage: native.nativeImage }))

let attention: DesktopAttention | undefined
afterEach(() => {
  attention?.dispose()
  attention = undefined
  native.notices.length = 0
  vi.clearAllMocks()
  native.Notice.isSupported.mockReturnValue(true)
  native.app.isHidden.mockReturnValue(false)
})

function setup(platform: NodeJS.Platform = 'darwin') {
  const window = {
    visible: true,
    focused: false,
    isVisible() { return this.visible },
    isFocused() { return this.focused },
    isDestroyed: () => false,
    setOverlayIcon: vi.fn(),
  }
  const activated = vi.fn()
  attention = new DesktopAttention({
    locale: () => resolveDesktopLocale('en'),
    window: () => window as unknown as BrowserWindow,
    overlayIconPath: '/badge.png',
    activate: activated,
    platform,
  })
  return { window, activated }
}

const notice = (sessionId = 's-1', kind: 'turn-complete' | 'turn-error' | 'waiting' | 'job-complete' = 'turn-complete') =>
  ({ sessionId, title: 'Write the report', kind })

it('shows a localized reminder while the window is in the background and opens the Session on click', () => {
  const f = setup()
  expect(attention!.notify(notice())).toBe(true)
  expect(native.notices).toHaveLength(1)
  expect(native.notices[0]!.options).toEqual({ title: 'Reply ready', body: 'Write the report' })
  native.notices[0]!.emit('click')
  expect(f.activated).toHaveBeenCalledWith('s-1')
  expect(native.notices[0]!.close).toHaveBeenCalledOnce()
})

it('uses one label per attention reason', () => {
  setup()
  attention!.notify(notice('s-1', 'turn-error'))
  attention!.notify(notice('s-2', 'waiting'))
  attention!.notify(notice('s-3', 'job-complete'))
  expect(native.notices.map(entry => (entry.options as { title: string }).title))
    .toEqual(['Stopped with an error', 'Waiting for your confirmation', 'Background job finished'])
})

it('stays silent while the window is focused and visible, but not when the application is hidden', () => {
  const f = setup()
  f.window.focused = true
  expect(attention!.notify(notice())).toBe(false)
  native.app.isHidden.mockReturnValue(true)
  expect(attention!.notify(notice())).toBe(true)
  f.window.focused = false
  f.window.visible = false
  expect(attention!.notify(notice('s-2'))).toBe(true)
})

it('replaces an earlier reminder for the same Session and closes reminders on disposal', () => {
  setup()
  attention!.notify(notice())
  attention!.notify(notice())
  expect(native.notices[0]!.close).toHaveBeenCalledOnce()
  expect(native.notices).toHaveLength(2)
  attention!.dispose()
  expect(native.notices[1]!.close).toHaveBeenCalledOnce()
})

it('leaves attention to the platform when notifications are unsupported or rejected', () => {
  setup()
  native.Notice.isSupported.mockReturnValue(false)
  expect(attention!.notify(notice())).toBe(false)
  native.Notice.isSupported.mockReturnValue(true)
  attention!.notify(notice())
  native.notices[0]!.emit('failed')
  expect(native.notices).toHaveLength(1)
})

it('applies the numeric badge on macOS and Linux, and a taskbar dot on Windows', () => {
  setup('darwin')
  attention!.setBadge(3)
  expect(native.app.setBadgeCount).toHaveBeenLastCalledWith(3)
  attention!.setBadge(-2)
  expect(native.app.setBadgeCount).toHaveBeenLastCalledWith(0)
  attention!.dispose()

  const linux = setup('linux')
  attention!.setBadge(2.7)
  expect(native.app.setBadgeCount).toHaveBeenLastCalledWith(2)
  expect(linux.window.setOverlayIcon).not.toHaveBeenCalled()

  const windows = setup('win32')
  attention!.setBadge(2)
  const overlay = windows.window.setOverlayIcon.mock.calls.at(-1)
  expect(overlay?.[0]).toBeDefined()
  expect(overlay?.[1]).toBe('Unread activity')
  attention!.setBadge(0)
  expect(windows.window.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
})

it('reapplies the retained count after the primary window is rebuilt', () => {
  const f = setup('win32')
  attention!.setBadge(1)
  f.window.setOverlayIcon.mockClear()
  attention!.reapply()
  expect(f.window.setOverlayIcon).toHaveBeenCalledTimes(1)
})

it('normalizes renderer payloads at the IPC boundary', () => {
  expect(desktopAttentionNotice({ sessionId: 's-1', title: 'Reply', kind: 'turn-complete' }))
    .toEqual({ sessionId: 's-1', title: 'Reply', kind: 'turn-complete' })
  expect(desktopAttentionNotice({ sessionId: '', title: 'Reply', kind: 'turn-complete' })).toBeUndefined()
  expect(desktopAttentionNotice({ sessionId: 's-1', title: '   ', kind: 'turn-complete' })).toBeUndefined()
  expect(desktopAttentionNotice({ sessionId: 's-1', title: 'Reply', kind: 'other' })).toBeUndefined()
  const long = 'x'.repeat(ATTENTION_TITLE_MAX_LENGTH + 10)
  expect(desktopAttentionNotice({ sessionId: 's-1', title: long, kind: 'waiting' })?.title)
    .toHaveLength(ATTENTION_TITLE_MAX_LENGTH)
})
