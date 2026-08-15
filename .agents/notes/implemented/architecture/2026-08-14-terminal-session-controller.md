# Agent Note: Terminal session controller — one owner for adoption, steering, cancellation, and flush-on-exit

Status: implemented

English | [中文](2026-08-14-terminal-session-controller.zh.md)

## Problem

The terminal client grew two separate agent lifecycles: `runOneShot` and `runInteractive` each created, drove, flushed, and disposed their own Agent, so the minimal closed-loop semantics (same session across turns, submit-while-running, first-Ctrl+C-cancels, flush-on-exit) could only be fixed twice, and each fix risked diverging. A submission arriving mid-turn queued a second ordinary turn instead of steering, approvals could hang forever when the turn they belonged to was cancelled (the pending prompt was never dismissed), and the TUI composition mounted the `userQuestions` service with no `ask_user_question` tool, so the model could never ask the human anything.

## Decision

**One `TerminalSessionController` owns the session lifecycle for both surfaces.** It holds the live `AgentHandle`, adopts (`start`) and swaps (`replace`) sessions, routes every submission through one method, and owns the live event stream plus the approval/question answerers, all detached on `shutdown`. Both runners construct it with their own surface callbacks; the one-shot runner reuses the same `submit`/`shutdown` path as the REPL.

**`agent.status` decides steering.** `submit` steers while the agent reports `running` (consumed at the next step boundary, per the inbox's steering semantics) and follow-ups otherwise; the running indicator is driven by the controller, not by call-site bookkeeping. `settle` covers surfaces whose commands wake the agent themselves.

**First Ctrl+C cancels only the turn; Ctrl+D or `/quit`/`/exit` quits and flushes.** Cancellation also dismisses any pending prompt through `UiStore.dismissPrompt`, so an approval/question awaiting an answer resolves as a dismissal instead of hanging. `shutdown` is cancel-while-running → quiescence → flush → dispose → detach.

**Questions are preset numbers or typed text; approvals stay closed.** Option prompts render as free-text prompts whose single-digit shortcuts answer only from an empty buffer; a submitted line is parsed into in-range number tokens (selected presets) and leftover text (`custom`), so multi-select combines both. Option-free questions collect multi-line text until an empty line. Approvals remain a closed y/n choice, and a dismissed approval resolves `cancelled`, never `allowed-once`.

**`dsh exec "<task>"` is the canonical one-shot.** The launcher gains an `exec` subcommand that resolves to the tui profile with everything after it passed through to the app (`--json`, `--jsonl`, `--resume`, `-m`, `-i`, `--ephemeral`); bare `dsh "<task>"` stays as an alias. The TUI composition mounts the `tool-ask-user` row directly because it has no agent presets.

## Consequences

`TerminalSessionController` ships at per-file 100% coverage. The PTY e2e (CI lane, real Loader tree) now drives five scenarios: multi-turn with Chinese input and Ctrl+D flush verification against the persisted session artifact, typed custom answers for a preset question (the answer is asserted inside the next model request), a y-approved bash call, Ctrl+C cancelling only a slow turn with the session still usable, and plain `/quit`. The PTY driver pins `TIOCSWINSZ` so a fresh pty renders the Ink layout deterministically instead of inheriting a 0-row winsize. Submitting while a turn runs changes observable behavior: the line steers the in-flight turn at its next step boundary rather than opening a queued follow-up turn.

## Alternatives considered

- **Cancel-then-followup on mid-turn submission** — aborts the in-flight step and loses its partial work; steering at the next step boundary preserves it and matches the agent inbox's existing semantics.
- **Keep the bare positional as the only one-shot entry** — leaves one-shot indistinguishable from typoed interactive flags; an explicit `exec` mirrors Codex and keeps the positional as a compatible alias.
- **Mount the question tool through agent presets** — the TUI composition has no preset system, and adding one to reach a single tool row is more machinery than a direct bundle row plus its manifest dependency.
