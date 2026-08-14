# Agent Note: dsh becomes a Codex-style terminal client

Status: implemented

English | [中文](2026-08-14-dsh-terminal-tui-client.zh.md)

## Problem

The `dsh` launcher was only a profile booter: `--profile headless` ran one task and `web` launched the browser UI. There was no interactive terminal surface, so the primary CLI could not do what a Codex-style client does — hold a live session, stream output, show tool calls, answer approvals inline, and resume earlier sessions. Bare `dsh` also refused to run without `--profile`.

## Decision

A new `@deepseek-ai/dsh-tui` bundle (at `packages/bundle/tui`, profile `tui`) rides over `dsh-base` without Host, HTTP, or browser rows. Its `tui-startup` provider owns the command line (task positional, `--resume`, `--continue`, `--model`, `--help`) and publishes a `tuiStartup` service; its `tui-runner` plugin reads that service through lazy config. With a task the runner is one-shot (create/resume an Agent, drive to quiescence, flush, print the final text, exit by turn-end reason); without one it mounts a full-screen Ink/React app (top status bar, scrollable conversation, bottom input line) over an observable `UiStore`; Markdown, syntax highlight, and diff render as React components. It streams `session/event` deltas into that store, registers an `approval/request` answerer and a `userQuestions` provider that prompt inline (serialized through a prompt queue), and handles `/new`, `/resume`, `/sessions`, `/model`, `/status`, `/compact`, `/init`, `/doctor`, `/export`, `/diff`, `/undo`, `/help`, and `/quit`. Unknown commands dispatch to the shared `ctx.commands` registry, so `/compact`, `/goal`, `/feedback`, and `/permission` (all registered by base plugins) work unchanged. Resume replays the persisted transcript; live text streams into a single assistant row; `/model` mutates the live `ModelSelectionRef`, so it lands on the next step. Multi-line paste is one command; `@path` mentions resolve to file content with Tab completion; Shift+Tab cycles the permission preset, Ctrl+P toggles plan mode, and Ctrl+C cancels the running turn; the status bar shows the model, permission preset, and plan mode; a completion popup suggests slash commands and `@`-paths; `/diff` and `/undo` inspect and revert the session's recorded file diffs. User-defined prompt-template commands load from `$DSH_HOME/commands/*.md` (name = basename, optional `# heading` = description, body = template with a `$ARGUMENTS` placeholder) and register into the same command registry, so the terminal dispatches them like built-ins.

The launcher now defaults bare `dsh` (no `--profile`, no `web`/`plugin` subcommand) to the `tui` profile, so `dsh` starts an interactive session, `dsh "task"` is one-shot, and `dsh web` is unchanged. `--profile <name>` still boots any named profile; `dsh --help` with no profile keeps the launcher's own help.

## Verification

`tui` unit tests pin the render primitives (theme, Markdown, highlight, diff, present), the event dispatcher, slash parsing, and the raw-mode input reader; `startup.spec.ts` boots the provider through the real Loader and asserts the parsed invocation, help, and rejection paths; `runner.spec.ts` drives one-shot completion and error exit mapping over the real registries. `apps/cli/tests/args.spec.ts` pins the new default-profile routing, and the source-launch and built-bin e2e suites pin the non-TTY "no task provided" diagnostic.

## Alternatives considered

**Hand-roll the REPL into the launcher.** That would bypass the bundle/profile architecture and duplicate what `dsh-base` already mounts (agent, approval, questions, persistence). The bundle reuses the existing seams instead.

**Use a TUI framework (ink/React).** Adopted: matching Codex required a full-screen alternate-screen UI, which a raw-mode reader plus pure ANSI render modules cannot provide. It pulls React into the host plane and adds ink as a runtime dependency; the pure ANSI render modules remain for the one-shot text path.

**Keep one-shot on the `headless` profile.** Routing `dsh "task"` and bare `dsh` to different profiles splits the terminal client's identity; folding one-shot into `tui` keeps the command's modes under one app while `--profile headless` remains for scripts.

## Consequences

Bare `dsh` is now the product entry point and behaves like `codex`. The `tui` bundle shares the base's agent, tool, approval, question, and persistence seams, so its model-facing surface stays identical to the other modes. Streaming text is raw in live mode (Markdown applies only to replay), and `/model` switches take effect on the next step; both are documented deferred work rather than regressions.
