---
description: "仅桌面端的完成提醒：回复完成、出错、等待确认和后台任务结束的系统通知，以及未读角标和通用设置开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-attention

[English](README.md) | 中文

## 概述

本包是桌面端完成提醒的浏览器部分。一个不依赖 React 的控制器监视会话状态、会话目录、Agent 错误和后台任务来源，并通过 preload 桥把每次新的完成上报给 Electron 外壳。是否显示由外壳判断：用户不在应用前时才显示系统通知，并返回通知是否真正展示；只有展示过的活动才会增加未读角标。本包还提供两个通用设置开关，保存到外壳自己的设置文档。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

只在桌面配置中挂载本行。Web 应用包以 `disabled: profileContext.name !== 'desktop'` 声明它；在没有桥的浏览器中浏览器部分直接返回，不渲染任何通知或设置行。

本包要求外壳在 `globalThis.dshDesktop.attention` 上暴露 `protocolVersion: 1`。在 Electron 下，通知可见性、平台角标位置和通知点击导航都由外壳负责；点击通知会聚焦应用并打开刚完成的会话。

偏好保存在外壳的 `desktop/settings.json` 的 `attention` 下，两个字段默认均为 `true`，并且立即生效：关闭通知会停止新的系统提醒，关闭角标会清除角标。通知正文只包含本地化的原因和会话标题，回复正文不会离开应用。

<a id="understand-the-implementation"></a>
## 实现说明

控制器观察四个来源：`ctx.uiSession.sessionStatus` 提供每个会话的运行状态、待处理交互和主视图归属；会话目录提供显示标题和子代理来源；`ctx.remote.$on('api-session/error')` 提供 Agent 失败；`ctx.jobs.state` 提供后台任务清单，并按运行中的会话逐个监听。

运行到空闲的转换上报 `turn-complete`；若五秒内出现过错误，则该错误已上报 `turn-error`，不再重复。待处理交互出现时上报 `waiting`。任务行从 `running` 或 `stopping` 变为 `completed` 或 `failed` 时，以其所属会话上报 `job-complete`；用户主动 kill 属于自身操作，不发通知。

未读状态仅存在于进程内。只有外壳确认通知真正展示时，会话才进入未读集合；会话成为主视图、从通知打开或从目录消失时移出。角标数量即未读集合大小；macOS 与 Linux 使用 `app.setBadgeCount`，Windows 使用由 `apps/desktop` 的 `pnpm run render:badge-icon` 生成的 16 × 16 任务栏叠加圆点。

只在用户不在应用前时提醒：聚焦且可见、未被隐藏的窗口不会显示通知，渲染进程无法覆盖该判断。主窗口重建后会重新应用保留的 Windows 叠加图标。

<a id="dev-note"></a>
## 开发备注

Windows 任务栏圆点是提交的 `apps/desktop/resources/badge-windows.png`，由 `apps/desktop` 中的 `pnpm run render:badge-icon` 生成；修改颜色后需重新运行。客户端控制器会为本次窗口中运行过的每个会话保留任务清单监听，直到该会话从目录中消失，因为空清单与尚未到达的基线无法区分。

## Model Experience

None, as native notification and badge presentation observes settled Client state without contributing model context or Session events.

#### KV Cache effect

None; reporting a completion does not modify model requests.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **Windows 隐藏窗口**：窗口隐藏到托盘后任务栏按钮消失，叠加圆点要等窗口重新显示才可见；系统通知仍会出现，托盘不保留角标。
- **macOS 权限**：通知和 Dock 角标都需要已安装应用获得系统通知权限；权限被拒绝时两者都不会出现，应用内也没有提示。
- **进程内角标**：未读数量不持久化。重启应用会清零，即使相关会话从未被重新打开。
- **仅待处理交互**：`waiting` 依赖待处理交互注册表。若某个插件在回答审批或问题时没有注册待处理交互，就不会产生等待通知。
- **本地观察的任务**：只为本次应用生命周期内运行过的会话监听任务清单。本窗口从未运行过的会话所拥有的后台任务不会被观察，其结束不会产生通知。
