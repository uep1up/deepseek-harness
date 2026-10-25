# Agent Note: Desktop completion attention

Status: implemented

English | [中文](2026-10-25-desktop-completion-attention.zh.md)

## Problem

Desktop had one native reminder — the mandatory update readiness notification — and the app icon carried no unread state. A user working in another application had no signal when a reply finished, the Agent stopped with an error, a confirmation was waiting, or a background job settled. Closing the window deliberately sends no notification, so the missing coverage was activity after a turn, not the close itself.

## Decision

The browser half observes settled Client facts and reports them over a new Desktop attention bridge; Electron main owns presentation. The [package reference](../../../../packages/client/ui-desktop-attention/README.md) owns the source set and event mapping, and the [Desktop reference](../../../../apps/desktop/README.md#completion-attention) owns native behavior.

Four facts decide attention: a running-to-idle Session transition, the Agent error stream, a pending interaction appearing, and a job row settling. The renderer names the activity and the Session title; main decides whether the user is away, shows the notification, and answers whether it was shown. Only shown activity becomes unread, and a Session leaves the unread set when it becomes the main view, is opened from the notification, or leaves the catalog. The badge therefore counts work the user could not see, not every completion.

Preferences (`notifications`, `badge`) live in the shell settings document because the shell consumes them before and independently of any Host request, following the [shell configuration decision](2026-10-08-desktop-shell-configuration.md). Windows has no numeric taskbar badge, so it receives a rendered overlay dot; macOS and Linux use the platform badge count. A browser mounts the same plugin row but finds no bridge and contributes nothing.

## Alternatives considered

**Browser `Notification` and `navigator.setAppBadge` only.** The renderer cannot reliably decide whether the application is in front, and the Badging API has no reliable Electron mapping; both surfaces would disagree with the actual window state.

**Report completions from the Host.** The Host process owns Session state but has no native Electron surface, and routing every completion through a second process adds a transport path for presentation-only data.

**Badge every completion regardless of visibility.** A focused window already shows the result; counting it would badge activity the user just watched and make the count meaningless as an away signal.

## Consequences

Unread state is process-local and resets on restart. Windows loses its taskbar button while hidden to the tray, so the dot returns with the window. Notifications and the macOS Dock badge both depend on the installed application's notification permission. Job rosters are observed only for Sessions that ran in this window, so a job from a Session this window never activated settles silently.
