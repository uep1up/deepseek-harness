import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { readDesktopSettings, updateDesktopAttention } from '../src/settings.ts'

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }))

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-settings-'))
  onTestFinished(() => { rmSync(userData, { recursive: true, force: true }) })
  const directory = join(userData, 'desktop')
  mkdirSync(directory)
  return { userData, path: join(directory, 'settings.json') }
}

it('creates a discoverable default file on first launch without touching other preferences', () => {
  const { userData, path } = fixture()
  rmSync(join(userData, 'desktop'), { recursive: true })
  writeFileSync(join(userData, 'keybindings.json'), 'existing shortcuts\n')
  expect(readDesktopSettings(userData)).toEqual({
    updates: { allowTestAuthPopupWindow: false },
    attention: { notifications: true, badge: true },
  })
  expect(readFileSync(path, 'utf8')).toBe(`{
  "updates": {
    "allowTestAuthPopupWindow": false
  },
  "attention": {
    "notifications": true,
    "badge": true
  }
}
`)
  expect(readFileSync(join(userData, 'keybindings.json'), 'utf8')).toBe('existing shortcuts\n')
})

it.each(['{}', '{"updates": {}}', '{"other": 1, "updates": {"other": true}}'])('defaults an older document without rewriting it: %s', (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('loads explicit opt-in and opt-out on the next read without changing an earlier process snapshot', () => {
  const { userData, path } = fixture()
  for (const allow of [true, false]) {
    const raw = JSON.stringify({ updates: { allowTestAuthPopupWindow: allow }, custom: 'preserve' })
    writeFileSync(path, raw)
    expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(allow)
    expect(readFileSync(path, 'utf8')).toBe(raw)
  }
  const previous = readDesktopSettings(userData)
  writeFileSync(path, '{"updates":{"allowTestAuthPopupWindow":true}}')
  expect(previous.updates.allowTestAuthPopupWindow).toBe(false)
  expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(true)
})

it.each(['', '{', 'null', '[]', '{"updates":null}', '{"updates":[]}',
  '{"updates":{"allowTestAuthPopupWindow":"false"}}', '{"updates":{"allowTestAuthPopupWindow":1}}',
  '{"updates":{"allowTestAuthPopupWindow":null}}'])('reports invalid settings with their path and preserves the original: %s', (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(false)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('reports filesystem errors instead of replacing unreadable settings', () => {
  const { userData, path } = fixture()
  mkdirSync(path)
  expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(false)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(fs.statSync(path).isDirectory()).toBe(true)
})

it.each(['mkdirSync', 'writeFileSync'] as const)('continues with disabled popups when %s fails', (operation) => {
  const { userData, path } = fixture()
  const failure = Object.assign(new Error('settings creation denied'), { code: 'EACCES' })
  vi.spyOn(fs, operation).mockImplementation(() => { throw failure })
  expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(false)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), failure)
})

it('continues with defaults even when warning output fails', () => {
  const { userData, path } = fixture()
  writeFileSync(path, '{')
  vi.mocked(console.warn).mockImplementation(() => { throw new Error('output unavailable') })
  expect(readDesktopSettings(userData).updates.allowTestAuthPopupWindow).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('{')
})

it.each(['{}', '{"updates": {}}'])('defaults attention fields without rewriting the document: %s', (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect(readDesktopSettings(userData).attention).toEqual({ notifications: true, badge: true })
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it.each(['{"attention":null}', '{"attention":[]}', '{"attention":{"notifications":"false"}}',
  '{"attention":{"badge":1}}'])('falls back to enabled attention for an invalid document: %s', (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect(readDesktopSettings(userData).attention).toEqual({ notifications: true, badge: true })
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('persists attention changes while preserving unrelated fields and earlier updates', () => {
  const { userData, path } = fixture()
  writeFileSync(path, JSON.stringify({ updates: { allowTestAuthPopupWindow: true }, custom: 'preserve' }))
  expect(updateDesktopAttention(userData, { notifications: false })).toEqual({ notifications: false, badge: true })
  const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  expect(written).toEqual({
    updates: { allowTestAuthPopupWindow: true },
    custom: 'preserve',
    attention: { notifications: false, badge: true },
  })
  expect(updateDesktopAttention(userData, { badge: false })).toEqual({ notifications: false, badge: false })
})

it('creates the document before applying an update to a missing file', () => {
  const { userData, path } = fixture()
  expect(updateDesktopAttention(userData, { badge: false })).toEqual({ notifications: true, badge: false })
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    updates: { allowTestAuthPopupWindow: false },
    attention: { notifications: true, badge: false },
  })
})

it('refuses to rewrite an unreadable document', () => {
  const { userData, path } = fixture()
  writeFileSync(path, '{')
  expect(() => updateDesktopAttention(userData, { notifications: false })).toThrow()
  expect(readFileSync(path, 'utf8')).toBe('{')
})
