/** General Settings copy for Desktop completion attention. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '桌面通知',
  'description': '应用在后台时，回复完成、出错、等待确认或后台任务结束会显示系统通知。',
  'badge': '未读角标',
  'badgeDescription': '在应用图标上显示未读会话数量。',
  'error': '保存失败，请重试',
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'desktop.attention'

/** English dictionary. */
export const en: Record<keyof typeof zh, string> = {
  'title': 'Desktop notifications',
  'description': 'Show a system notification when a reply is ready, the agent stops with an error, waits for your confirmation, or a background job finishes while the app is in the background.',
  'badge': 'Unread badge',
  'badgeDescription': 'Show the number of unread sessions on the app icon.',
  'error': 'Could not save. Try again.',
}

/** Every key this plugin localizes. */
export type DesktopAttentionKey = keyof typeof zh
