# Agent Note: Desktop completion attention

Status: implemented

[English](2026-10-25-desktop-completion-attention.md) | 中文

## 问题

Desktop 原本只有一种原生提醒——强制更新的就绪通知——应用图标也不携带未读状态。用户在别的应用里工作时，回复完成、Agent 出错、等待确认或后台任务结束都没有任何提示。关闭窗口本身有意不发送通知，因此缺少的是回合结束后的活动提醒，而不是关闭行为本身。

## 决定

浏览器部分观察已经定论的 Client 事实，并通过新的 Desktop 提醒桥上报；Electron 主进程负责呈现。[包参考](../../../../packages/client/ui-desktop-attention/README.zh.md)说明来源集合与事件映射，[Desktop 参考](../../../../apps/desktop/README.zh.md#completion-attention)说明原生行为。

四类事实决定提醒：运行到空闲的会话转换、Agent 错误流、待处理交互出现，以及任务行结算。渲染进程给出活动类型和会话标题；主进程判断用户是否不在应用前、显示通知，并回答通知是否真正展示。只有展示过的活动才进入未读，会话成为主视图、从通知打开或离开目录时移出未读集合。因此角标统计的是用户没能看到的成果，而不是每一次完成。

偏好（`notifications`、`badge`）保存在外壳设置文档中，因为外壳在任何 Host 请求之前、且独立于 Host 消费它们，遵循[外壳配置决策](2026-10-08-desktop-shell-configuration.zh.md)。Windows 没有数字任务栏角标，因此使用渲染好的叠加圆点；macOS 与 Linux 使用平台角标计数。浏览器也会挂载同一插件行，但找不到桥，因此不贡献任何内容。

## 考虑过的替代方案

**只用浏览器 `Notification` 与 `navigator.setAppBadge`。** 渲染进程无法可靠判断应用是否在前台，Badging API 在 Electron 中也没有可靠映射；两个界面都会与实际窗口状态不一致。

**由 Host 上报完成。** Host 进程持有会话状态，但没有原生 Electron 界面；让每次完成跨第二个进程转发，会为纯呈现数据引入额外的传输路径。

**无论是否可见都计入角标。** 聚焦窗口已经展示结果，再计入会让用户刚看过的活动也形成角标，使计数失去"离开提示"的意义。

## 后果

未读状态只存在于进程内，重启后清零。Windows 隐藏到托盘后没有任务栏按钮，圆点会随窗口重新显示。通知和 macOS Dock 角标都依赖已安装应用的通知权限。只为本次窗口中运行过的会话观察任务清单，因此本窗口从未激活的会话的任务结束不会提醒。
