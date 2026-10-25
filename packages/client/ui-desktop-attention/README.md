---
description: "Desktop-only completion attention: native notifications for finished replies, errors, pending confirmations, and settled background jobs, plus the unread badge and its General Settings toggles."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-attention

English | [中文](README.zh.md)

## Summary

This package is the browser half of Desktop completion attention. A framework-free controller watches the Session status, Session catalog, Agent-error, and background-job sources, and reports each new completion to the Electron shell through the preload bridge. The shell decides whether the user is away, shows the native notification, and answers whether it was shown; only shown activity raises the unread badge. The package also contributes the two General Settings toggles that persist into the shell's own settings document.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount this row only in the Desktop profile. The Web application bundle declares it with `disabled: profileContext.name !== 'desktop'`, and the browser half returns without a contribution when no bridge is present, so an ordinary browser renders neither notification nor settings row.

The package requires a shell that exposes `globalThis.dshDesktop.attention` with `protocolVersion: 1`. Under Electron the shell owns notification visibility, platform badge placement, and notification click navigation; a click focuses the application and opens the Session that finished.

Preferences live in the shell's `desktop/settings.json` under `attention`, default `true` for both members, and apply immediately: disabling notifications stops new native reminders, and disabling the badge clears it. Notification bodies contain only the localized reason and the Session title; reply text never leaves the application.

<a id="understand-the-implementation"></a>
## Understand the implementation

The controller observes four sources. `ctx.uiSession.sessionStatus` supplies each Session's running state, pending-interaction presence, and main-view ownership; the Session catalog supplies display titles and subagent origins; `ctx.remote.$on('api-session/error')` supplies Agent failures; and `ctx.jobs.state` supplies background-job rosters, watched per running Session.

A running-to-idle transition reports `turn-complete`, unless an error arrived within the last five seconds, in which case that error already reported `turn-error`. A pending interaction appearing reports `waiting`. A job row leaving `running` or `stopping` for `completed` or `failed` reports `job-complete` for its owning Session; a kill is the user's own action and stays silent.

Unread tracking is process-local. A Session enters the unread set only when the shell reports that it actually showed the reminder, and leaves it when the Session becomes the main view, is opened from a notification, or disappears from the catalog. The badge count is the unread-set size; macOS and Linux apply it with `app.setBadgeCount`, and Windows applies a 16 × 16 taskbar overlay dot rendered by `pnpm run render:badge-icon` in `apps/desktop`.

Notifications are allowed only while the user is away: a focused, visible, non-hidden window skips them, and the renderer never overrides that decision. Rebuilding the primary window reapplies the retained Windows overlay.

<a id="dev-note"></a>
## Dev Note

The Windows taskbar dot is the committed `apps/desktop/resources/badge-windows.png`, rendered by `pnpm run render:badge-icon` in `apps/desktop`; re-run it after changing the colour. The client controller keeps a job roster watch for every Session that ran in this window until that Session leaves the catalog, because an empty roster and a baseline that has not arrived yet are indistinguishable.

## Model Experience

None, as native notification and badge presentation observes settled Client state without contributing model context or Session events.

#### KV Cache effect

None; reporting a completion does not modify model requests.

## Known Limitations and Deferred Work

- **Windows hidden window** — the taskbar button disappears when the window is hidden to the tray, so the overlay dot is not visible until the window is shown again; the native notification still appears, and the tray keeps no badge.
- **macOS permission** — both notifications and the Dock badge require the operating system's notification permission for the installed application; denied permission leaves both silent without an in-app warning.
- **Process-local badge** — the unread count is not persisted. Restarting the application clears it even when Sessions were never reopened.
- **Pending interactions only** — `waiting` relies on the pending-interaction registry. A plugin that answers an approval or question without registering a pending interaction produces no waiting notification.
- **Locally observed jobs** — job rosters are watched for Sessions that ran during this application lifetime. A background job owned by a Session this window never ran is not observed, so its settlement raises no notification.
