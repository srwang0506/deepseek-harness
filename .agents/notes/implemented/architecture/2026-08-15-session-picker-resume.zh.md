# Agent Note：会话选择器与 `dsh resume` — 续跑与分叉持久化会话的统一选择面

Status: implemented

[English](2026-08-15-session-picker-resume.md) | 中文

## 问题

终端客户端此前只能按 id（`--resume <id>`）、按最近（`--continue`）或通过纯文本列表（`/sessions`）续跑会话，而列表行无法直接操作。启动器完全没有 `resume` 词汇，要回到一个更早的会话必须先找到它的 id。分叉只对当前会话可用（`/fork`）；持久化会话无法从终端分叉，尽管会话存储的分叉语义本就覆盖带 seed 的谱系。

## 决策

**一个选择面，三个入口。** TUI 中的选择器覆盖层按最新优先列出持久化会话，标题从会话日志折叠而来（`ctx.sessionQuery.listSessions` + `readTitleSnapshots`；未挂载查询服务时回退到 `persistence.list()`）。它由不带参数的 `/resume`、启动器的裸 `dsh resume` 以及（通过内部的 `--resume-picker` 启动标志）`dsh resume` 的整个首屏打开。方向键移动高亮，Enter 续跑选中项，`f` 分叉它，Esc 取消；没有任何持久化会话时回退到全新会话。覆盖层替换输入行，并通过纯函数 `pickerIntent` 在普通 `keyIntent` 映射之前路由按键。

**`dsh resume` 是映射到既有 tui 标志的启动器子命令。** `dsh resume --last` 解析为 `--continue`，`dsh resume <id>` 解析为 `--resume <id>`，裸 `dsh resume` 解析为 `--resume-picker`；tui startup 只新增了这一个布尔标志。

**按 id 分叉通过 agents 注册表加载持久化源会话。** `forkSessionById` 对在线会话直接分叉；对持久化会话先 `agents.resume` 加载源，再从在线 Agent 的会话分叉（经由存储的 seed 语义保留 cwd 与父谱系），并销毁已加载的 handle，使源不会泄漏为在线条目。

## 后果

`pickerSessions` 与 `forkSessionById` 已导出并获得单元覆盖；选择器按键映射是带独立 spec 的纯函数 `pickerIntent`，覆盖层经由既有 `UiStore` 快照以 Ink 圆角边框盒渲染。PTY e2e 现在先用 `dsh exec` 播种会话，再驱动两个新场景：`dsh resume --last` 重放最近转录，以及裸 `dsh resume` 用方向键移动高亮并续跑两个播种会话中较旧的那个。驱动器新增 `arrow` 步骤并像键入键一样等待回显——在子进程读取转义序列之前写入的 Enter 会合并成一个 chunk，被 Ink 解析为单次方向键按键，尾随的 CR 就此丢失。

## 备选方案

- **选择器作为独立的 Ink 渲染树**：每次打开都要一轮渲染/卸载；现有快照中的覆盖层复用 store、状态栏与退出路径，不做改动。
- **在启动器中解析 `dsh resume` 的 id**：启动器无法访问持久化服务；映射到 tui 应用既有的 `--continue`/`--resume` 标志，让解析留在服务所在之处。
- **用 `sessions.create(id, { seed })` 加存储移除 API 分叉持久化会话**：不存在公开的移除接口；agents 注册表的加载-销毁路径是官方缝隙，且不留在线残留。
