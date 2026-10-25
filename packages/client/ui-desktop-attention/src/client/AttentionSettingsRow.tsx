/** General Settings rows for Desktop completion notifications and the unread badge. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttentionPreferences, AttentionSource } from './attention.ts'
import css from './AttentionSettingsRow.module.css'

/** Accepted preferences, writer callbacks, and the observable the renderer binds. */
export interface AttentionSettingsRowInjected {
  hooks: { attention: AttentionSource<AttentionPreferences> }
  setNotifications(enabled: boolean): Promise<void>
  setBadge(enabled: boolean): Promise<void>
}

/**
 * Render the two Desktop attention toggles.
 * @param props - accepted preferences, writers, and localized copy.
 * @returns the General Settings rows.
 */
export function AttentionSettingsRow({ useAttention, setNotifications, setBadge, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'desktop.attention'> & InjectFace<AttentionSettingsRowInjected>) {
  const preferences = useAttention(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const write = (operation: () => Promise<void>): void => {
    setFailed(false)
    setBusy(true)
    void operation().catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
  }
  return <>
    <div className={css.row}>
      <div className={css.text}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.description}>{t('description')}</div>
        {failed && <div className={css.error} role="alert">{t('error')}</div>}
      </div>
      <Switch checked={preferences.notifications} disabled={busy} label={t('title')}
        onChange={(next) => { write(() => setNotifications(next)) }} />
    </div>
    <div className={css.row}>
      <div className={css.text}>
        <div className={css.title}>{t('badge')}</div>
        <div className={css.description}>{t('badgeDescription')}</div>
      </div>
      <Switch checked={preferences.badge} disabled={busy} label={t('badge')}
        onChange={(next) => { write(() => setBadge(next)) }} />
    </div>
  </>
}
