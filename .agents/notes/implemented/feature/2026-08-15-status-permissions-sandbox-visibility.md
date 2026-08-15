# Agent Note: Session security state becomes visible — /status, /permissions, and a sandbox-aware status bar

Status: implemented

English | [中文](2026-08-15-status-permissions-sandbox-visibility.zh.md)

## Problem

The Codex-alignment review found the TUI could not answer the questions every user asks before trusting an agent: which sandbox mode is this session running under, which approval policy applies, and what does the model actually see. The sandbox mode and approval policy were durable session facts (`sandbox/mode`, `approval/policy`, `permission/preset` events, folded on replay), but no terminal surface rendered them, so the interaction structure around safety was forming around an invisible state.

## Decision

**Surface the durable facts, do not invent new state.** The bottom status bar (a dim Codex-style line beneath the plain composer line) splits session facts on the left — the effective sandbox mode from `ctx.sandboxPolicy.resolve({ session })`, token usage, and the permission preset — from the model with its reasoning effort on the right, with a braille spinner while a turn runs. `/status` reports the complete session state — session id, model and reasoning effort, the `-m` launch override, cwd, sandbox mode with its workspace root, approval policy, permission preset with its options, event and token counts, and the OpenAI login state. `/permissions [preset]` shows the effective preset and every advertised option, or switches the session through `permissionPresets.set` (one `permission/preset` + knob events), clearly separating the two grant scopes: answering an approval prompt grants one operation, a preset switch is the durable session policy restored on resume.

**Pure row builders, thin closure.** `sessionStatusRows` and `permissionRows` are exported pure functions over plain inputs; the runner closure only folds the live seams (sandbox policy, approval override, presets, token meter, credential store) into them.

## Consequences

Both builders are unit-covered (row sets, override markers, login states, preset marking); the PTY e2e drives `/status`, `/permissions`, and `/permissions read-only`, asserting the status bar re-renders and the `sandbox/mode` + `permission/preset` events persist. `dsh login status` now reports the login state under the login command, reserving `dsh status` for authentication-only output. The composer-level Codex features (fuzzy file search, `Ctrl+R` history search, Vim mode, Tab queueing, edit-and-fork), `untrusted` command-trust classification, extra writable directories, and instruction-file listing are documented as deferred in the package README.

## Alternatives considered

- **A modal overlay panel for /status** — a full-screen overlay needs focus and dismissal machinery the store does not own; inline rows reuse the /help pattern and stay in the scrollback.
- **A direct `/sandbox <mode>` switch** — the preset table already owns the sandbox+approval bundle; a parallel sandbox-only knob would create two write paths for one durable fact until Codex-style independent flags arrive.
