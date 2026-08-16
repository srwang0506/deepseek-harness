# Agent Note: Codex visual parity — markers, status line, session header, and footer

Status: implemented

English | [中文](2026-08-15-codex-visual-parity.zh.md)

## Problem

The TUI approximated Codex's terminal style from memory: the invented `⏺` marker, a status line that was neither color-coded nor laid out like Codex's footer, and no session header or onboarding block. Reading the `codex-rs` TUI source (`history_cell/messages.rs`, `bottom_pane/footer.rs`, `status_line_style.rs`, `history_cell/separators.rs`, `history_cell/session.rs`, `style.rs`) showed the exact contract and several concrete mismatches.

## Decision

**Copy the source, not the recollection.** `messages.rs` renders the user message with `"› ".bold().dim()` (continuation `  `), assistant/reasoning/tool rows with `"• ".dim()`, and reasoning as dim italic `• ` bullets; `separators.rs` draws a dim `─` rule, labeled `─ Local tools: N calls ─` for turns that ran tools; `status_line_style.rs` color-codes the `/statusline` segments (model cyan, usage green, branch/mode magenta) joined by a dim ` · `; `session.rs` opens a session with a bordered header naming the model and onboarding hints. Each of those is now reproduced in `packages/bundle/tui`: `renderRow`/`render.ts` markers, `statusText` segments with an `accent` per segment, a `header` row kind rendered as a bordered box, and a per-store tool-call counter that labels the turn separator.

**The footer matches Codex's split.** The single footer line shows key hints (`? for shortcuts`, the braille spinner while running, `⇥ queued`) on the left and the color-coded status line (model, tokens, git branch from a new `gitBranch` helper, sandbox mode, permission preset, plan) on the right. A fresh session pushes a `header` + onboarding rows; a resumed session pushes the header before replaying the transcript.

## Consequences

`git.ts` is unit-covered at 100%; the marker/separator/header changes are covered by `render.spec.ts` and `ui-render.spec.ts`, and the full 18-scenario PTY e2e passes with the new boot header and footer. READMEs describe the footer split, the session header/onboarding, and the labeled separators. User messages and the composer carry a subtle `#1e1e1e` background, Codex's `user_message_style` white-12%-on-dark approximation.

## Alternatives considered

- **Full-width backgrounds and exact alpha** — Ink's `backgroundColor` covers the text width, not the row, and does not take alpha; the fixed `#1e1e1e` is the closest available approximation without a custom full-row background widget.
- **Git branch via a spawned `git` process** — reading `.git/HEAD` directly is cheaper, deterministic, and covers the common symbolic-HEAD case; worktrees and detached HEADs simply omit the branch, matching Codex's "omitted when unavailable".
