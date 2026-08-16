# Agent Note：Codex 视觉对齐 —— 标记、状态行、会话头与 footer

Status: implemented

[English](2026-08-15-codex-visual-parity.md) | 中文

## 问题

TUI 凭记忆近似了 Codex 的终端风格：臆造的 `⏺` 标记、既不分段着色也不按 Codex footer 布局的状态行，也没有会话头或 onboarding 块。阅读 `codex-rs` TUI 源码（`history_cell/messages.rs`、`bottom_pane/footer.rs`、`status_line_style.rs`、`history_cell/separators.rs`、`history_cell/session.rs`、`style.rs`）后确认了确切契约与几处具体不一致。

## 决策

**照抄源码，而非回忆。** `messages.rs` 用 `"› ".bold().dim()`（续行 `  `）渲染用户消息，用 `"• ".dim()` 渲染 assistant/reasoning/工具行，reasoning 为 dim italic 的 `• ` 项目符号；`separators.rs` 画 dim `─` 横线，工具轮次标注 `─ Local tools: N calls ─`；`status_line_style.rs` 给 `/statusline` 分段着色（模型青、用量绿、分支/模式品红），以 dim ` · ` 连接；`session.rs` 以 `SessionHeaderHistoryCell` 标题卡与 onboarding 帮助块开启会话。以上均已在 `packages/bundle/tui` 复刻：`renderRow`/`render.ts` 的标记、`statusText` 每段带 `accent` 的分段、`header` 行类型、以及标注轮次分隔的 per-store 工具调用计数。

**头部是 Codex 的标题卡，而非模型标签。** `SessionHeaderHistoryCell` 渲染 `>_ OpenAI Codex (vX)`、空行、dim 标签的 `model:` 行（带 reasoning effort 与 `/model to change` 提示）、相对化为 `~` 的 `directory:` 行，以及非受限时的品红 `permissions: YOLO mode` 行，内宽钳制在 56 列并对目录居中截断。runner 通过 `header` 行推入这些事实（`appName`、`version`、`model`、`reasoningEffort`、`directory`、`yoloMode`）；`app.tsx` 渲染 dim 边框、dim 标签与加粗标题，`header.ts` 提供 `appVersion()`（取自 `DSH_VERSION`，由 `apps/cli/src/bin.ts` 设为 CLI 版本）以及 `relativizeHome()`、`centerTruncate()`。YOLO 对应 `danger-full-access` sandbox 模式。

**onboarding 块逐行对齐 Codex。** 新会话推入 dim 的 `To get started, describe a task or try one of these commands:` 引导语、空行，随后是 `/init`、`/status`、`/permissions`、`/model`、`/review`——每行两空格缩进、以 ` - ` 分隔，`/init` 居首。

**终端标题对齐 Codex 的 OSC-0 写路径。** `terminal-title.ts` 镜像 `terminal_title.rs`：stdout 为终端时写一条经净化的 `\x1b]0;…\x07`（剥离控制/不可见字符、折叠空白、240 字符上限），退出时显式清除——runner 组装 `dsh | <会话标题或模型> | <分支>`，并在会话标题生成后的轮次结束更新。

**footer 对齐 Codex 的分栏。** 单行 footer 左侧显示按键提示（`? for shortcuts`、运行中的 braille spinner、`⇥ queued`），右侧显示分段着色状态行（模型、token、新 `gitBranch` 助手读出的 git 分支、sandbox 模式、plan）。新会话推入标题卡 `header` + onboarding 行；续跑会话在重放转录前推入 header。

## 后果

`git.ts`、`terminal-title.ts` 与 `header.ts` 单元覆盖率 100%；标记/分隔/头部的改动由 `render.spec.ts` 与 `ui-render.spec.ts` 覆盖，带新启动头与 footer 的 18 个 PTY e2e 全部通过。README 描述 footer 分栏、会话头/onboarding 与带标签分隔。行不设底色：Ink 的 `backgroundColor` 只涂文本跨度，会让输入字符被深色块遮住，因此行仅用标记与 dim 样式。

## 备选方案

- **用户消息底色**——Codex 的 `user_message_style` 在深色终端上画白 12% 透明度的整行底色；Ink 的 `backgroundColor` 只覆盖文本跨度且不接受 alpha，固定的深色底会遮住输入字符，因此省略底色而非近似。
- **spawn `git` 进程读分支**——直接读 `.git/HEAD` 更廉价、确定性更强，覆盖常见的符号 HEAD 情形；worktree 与 detached HEAD 直接省略分支，与 Codex 的「不可用则省略」一致。
