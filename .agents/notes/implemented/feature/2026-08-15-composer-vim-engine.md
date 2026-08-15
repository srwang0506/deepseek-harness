# Agent Note: Composer cursor editing with a Vim normal-mode subset

Status: implemented

English | [中文](2026-08-15-composer-vim-engine.zh.md)

## Problem

The composer was an append-only string: input accumulated at the end, Esc discarded the whole line, and there was no cursor, no mid-line editing, and no way to fix a typo without clearing everything. The Codex-alignment review called the input experience out as the largest gap — Codex's composer is a small editor.

## Decision

**A pure edit engine over {text, cursor, vim}.** `applyComposerKey(edit, keyInput, key)` in `src/ui/composer.ts` resolves every no-prompt keypress: insert mode inserts at the cursor, backspace/Delete edit around it, arrow keys move it, Enter submits the whole text and resets, and control keys (Ctrl+C/D/P/R/U, Tab, Shift+Tab) bubble up as surface intents. Esc toggles Vim normal mode, where `h`/`l`/`0`/`$`/`w`/`b` move, `x` deletes under the cursor, `D` deletes to the line end, and `i`/`a`/`I`/`A` re-enter insert at the matching cursor. Esc therefore no longer clears the line; Ctrl+U does (Vim's own clear).

**Multi-line pastes are text, not submission.** A chunk containing more than one line inserts verbatim — trailing newline included — instead of tripping the coalesced-Enter path, which only fires for a single-line body with a trailing `\r`/`\n`; Enter then submits the whole composer as one message.

**The App owns rendering, not editing.** The App keeps one `ComposerEdit` state, routes no-prompt keys through the engine (prompts keep `keyIntent`), and renders the cursor as an inverse character (a block `█` at the line end). Same-tick keystrokes update an eager ref before React re-renders, or a second chunk in the same tick would edit stale text.

## Consequences

`composer.ts` is unit-covered at 100% (19 tests incl. multi-line paste with and without a trailing newline: insertion at cursor, backspace/Delete, clamping, word motions, mode toggles, submission, coalesced Enter chunks, control keys). The PTY e2e gained a `raw` driver op for keys with no visible echo and a scenario that types `abcd`, Esc, `h`, `x`, Esc, `e` and asserts `abce` reaches the model. The help text and READMEs document the key map; the Known Limitations list drops Vim mode from the deferred composer work.

## Alternatives considered

- **Ink's `TextInput` component** — it owns its own raw-mode key handling, which would fork the key stream the app already routes through `useInput` (steering, prompts, pickers); a pure engine reuses one key path.
- **Full Vim (pending `d` commands, registers, visual mode)** — the line-editor surface needs motions and mode toggles, not registers; the subset is the smallest complete-feeling editor, and pending-command state can extend the engine later without changing the App contract.
