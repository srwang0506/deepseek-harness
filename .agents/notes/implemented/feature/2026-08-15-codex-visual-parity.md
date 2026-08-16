# Agent Note: Codex visual parity — markers, status line, session header, and footer

Status: implemented

English | [中文](2026-08-15-codex-visual-parity.zh.md)

## Problem

The TUI approximated Codex's terminal style from memory: the invented `⏺` marker, a status line that was neither color-coded nor laid out like Codex's footer, and no session header or onboarding block. Reading the `codex-rs` TUI source (`history_cell/messages.rs`, `bottom_pane/footer.rs`, `status_line_style.rs`, `history_cell/separators.rs`, `history_cell/session.rs`, `style.rs`) showed the exact contract and several concrete mismatches.

## Decision

**Copy the source, not the recollection.** `messages.rs` renders the user message with `"› ".bold().dim()` (continuation `  `), assistant/reasoning/tool rows with `"• ".dim()`, and reasoning as dim italic `• ` bullets; `separators.rs` draws a dim `─` rule, labeled `─ Local tools: N calls ─` for turns that ran tools; `status_line_style.rs` color-codes the `/statusline` segments (model cyan, usage green, branch/mode magenta) joined by a dim ` · `; `session.rs` opens a session with the `SessionHeaderHistoryCell` title card and the onboarding help block. Each of those is now reproduced in `packages/bundle/tui`: `renderRow`/`render.ts` markers, `statusText` segments with an `accent` per segment, a `header` row kind, and a per-store tool-call counter that labels the turn separator.

**The header is Codex's title card, not a model label.** `SessionHeaderHistoryCell` renders `>_ OpenAI Codex (vX)`, a blank line, a dim-label `model:` row (with the reasoning effort and a `/model to change` hint), a `directory:` row relativized to `~`, and a magenta `permissions: YOLO mode` row when unrestricted, clamped to a 56-column inner width with the directory center-truncated. The runner pushes those facts through a `header` row (`appName`, `version`, `model`, `reasoningEffort`, `directory`, `yoloMode`); `app.tsx` renders the dim border, dim labels, and bold title, and `header.ts` supplies `appVersion()` (from `DSH_VERSION`, which `apps/cli/src/bin.ts` sets to the CLI version) plus `relativizeHome()` and `centerTruncate()`. YOLO maps to the `danger-full-access` sandbox mode.

**The onboarding block matches Codex line-for-line.** A fresh session pushes the dim `To get started, describe a task or try one of these commands:` intro, a blank line, then `/init`, `/status`, `/permissions`, `/model`, and `/review` — each indented two spaces with a ` - ` separator and `/init` first.

**The terminal title matches Codex's OSC-0 write.** `terminal-title.ts` mirrors `terminal_title.rs`: one sanitized `\x1b]0;…\x07` write (control/invisible characters stripped, whitespace collapsed, 240-char bound) when stdout is a TTY, and an explicit clear on exit — the runner assembles `dsh | <session-title-or-model> | <branch>`, updating it on turn end once the session title exists.

**The footer matches Codex's split.** The single footer line shows key hints (`? for shortcuts`, the braille spinner while running, `⇥ queued`) on the left and the color-coded status line (model, tokens, git branch from a new `gitBranch` helper, sandbox mode, plan) on the right. A fresh session pushes the title-card `header` + onboarding rows; a resumed session pushes the header before replaying the transcript.

## Consequences

`git.ts`, `terminal-title.ts`, and `header.ts` are unit-covered at 100%; the marker/separator/header changes are covered by `render.spec.ts` and `ui-render.spec.ts`, and the full 18-scenario PTY e2e passes with the new boot header and footer. READMEs describe the footer split, the session header/onboarding, and the labeled separators. No row background is set: Ink's `backgroundColor` paints only the text span and hid the typed characters behind a dark block, so rows use markers and dim styling only.

## Alternatives considered

- **User-message background tint** — Codex's `user_message_style` draws a white-12%-on-dark row background; Ink's `backgroundColor` covers only the text span and does not take alpha, and a fixed dark tint hid the typed characters, so the tint is omitted rather than approximated.
- **Git branch via a spawned `git` process** — reading `.git/HEAD` directly is cheaper, deterministic, and covers the common symbolic-HEAD case; worktrees and detached HEADs simply omit the branch, matching Codex's "omitted when unavailable".
