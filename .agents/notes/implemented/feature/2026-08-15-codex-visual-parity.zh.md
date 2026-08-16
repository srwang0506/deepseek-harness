# Agent Note：Codex 视觉对齐 —— 标记、状态行、会话头与 footer

Status: implemented

[English](2026-08-15-codex-visual-parity.md) | 中文

## 问题

TUI 凭记忆近似了 Codex 的终端风格：臆造的 `⏺` 标记、既不分段着色也不按 Codex footer 布局的状态行，也没有会话头或 onboarding 块。阅读 `codex-rs` TUI 源码（`history_cell/messages.rs`、`bottom_pane/footer.rs`、`status_line_style.rs`、`history_cell/separators.rs`、`history_cell/session.rs`、`style.rs`）后确认了确切契约与几处具体不一致。

## 决策

**照抄源码，而非回忆。** `messages.rs` 用 `"› ".bold().dim()`（续行 `  `）渲染用户消息，用 `"• ".dim()` 渲染 assistant/reasoning/工具行，reasoning 为 dim italic 的 `• ` 项目符号；`separators.rs` 画 dim `─` 横线，工具轮次标注 `─ Local tools: N calls ─`；`status_line_style.rs` 给 `/statusline` 分段着色（模型青、用量绿、分支/模式品红），以 dim ` · ` 连接；`session.rs` 以命名模型的带边框头与 onboarding 提示开启会话。以上均已在 `packages/bundle/tui` 复刻：`renderRow`/`render.ts` 的标记、`statusText` 每段带 `accent` 的分段、以带边框盒渲染的 `header` 行类型、以及标注轮次分隔的 per-store 工具调用计数。

**footer 对齐 Codex 的分栏。** 单行 footer 左侧显示按键提示（`? for shortcuts`、运行中的 braille spinner、`⇥ queued`），右侧显示分段着色状态行（模型、token、新 `gitBranch` 助手读出的 git 分支、sandbox 模式、权限预设、plan）。新会话推入 `header` + onboarding 行；续跑会话在重放转录前推入 header。

## 后果

`git.ts` 单元覆盖率 100%；标记/分隔/头部的改动由 `render.spec.ts` 与 `ui-render.spec.ts` 覆盖，带新启动头与 footer 的 18 个 PTY e2e 全部通过。README 描述 footer 分栏、会话头/onboarding 与带标签分隔。用户消息与 composer 携带 `#1e1e1e` 微妙底色，即 Codex `user_message_style` 深色终端白 12% 透明度的近似。

## 备选方案

- **全宽背景与精确透明度**——Ink 的 `backgroundColor` 只覆盖文本宽度而非整行，也不接受 alpha；固定 `#1e1e1e` 是无自定义全行背景组件下最接近的近似。
- **spawn `git` 进程读分支**——直接读 `.git/HEAD` 更廉价、确定性更强，覆盖常见的符号 HEAD 情形；worktree 与 detached HEAD 直接省略分支，与 Codex 的「不可用则省略」一致。
