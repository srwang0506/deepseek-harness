# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh terminal-surface bundle: a Codex-style full-screen terminal client (Ink/React) over [`dsh-base`](../base/README.md). [`cordis.patch.yml`](cordis.patch.yml) supplies the coding persona and tool mode, disables HMR, and inserts this package's `tui-startup` provider and `tui-runner` plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

The ordinary `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)) and parses this app's command line: the one-shot task positional, `--resume <id>`, `--continue`, `--model <model>`, and `--help`. The runner injects that service and reads the invocation from lazy config.

The runner ([`src/index.ts`](src/index.ts)) has two modes. With a non-empty `task` it drives one fresh or resumed Agent through `ctx.agents`, waits for quiescence, flushes the Session, prints the last non-empty assistant text, and exits 0 for a completed final turn (1 otherwise). With no task it mounts a full-screen Ink app ([`src/ui/app.tsx`](src/ui/app.tsx)) over an observable store ([`src/ui/store.ts`](src/ui/store.ts)): it streams session events to the terminal (assistant text, reasoning, tool calls, and results with diff coloring), answers approval/questions inline by registering an `approval/request` answerer and a `userQuestions` provider, answers approvals inline (Shift+Tab cycles the permission preset, Ctrl+P toggles plan mode), resolves `@path` mentions to file content with Tab completion, recalls submitted lines with ↑↓ prompt history, runs `!`-prefixed lines as local shell commands, and loads user-defined prompt-template commands from `$DSH_HOME/commands/*.md`, and handles the slash commands `/new`, `/resume [id]`, `/sessions`, `/model [model]`, `/login [method]`, `/logout`, `/status`, `/compact`, `/init`, `/doctor`, `/export`, `/diff`, `/review`, `/undo`, `/help`, and `/quit`; `/login` suspends the Ink surface to run the browser/device/API-key OpenAI GPT flow on the raw terminal. A resumed session replays its persisted transcript as styled Markdown before the prompt.

Rendering is a set of pure, zero-dependency modules: [`src/theme.ts`](src/theme.ts) (ANSI), [`src/markdown.ts`](src/markdown.ts), [`src/highlight.ts`](src/highlight.ts), [`src/diff.ts`](src/diff.ts), and [`src/render.ts`](src/render.ts) (event dispatch).

## Model Experience

None added by this bundle: prompts and tools belong to the base rows. The persona restates the same coding-agent sentence as the other surfaces.

#### KV Cache effect

None; the runner adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **Streaming text is raw** — live chunk deltas stream unformatted; Markdown styling applies only to a resumed transcript's replay.
- **`/model` takes effect on the next step** — the mutable model selection is read at each step's prompt assembly, so a switch lands on the following turn, not the in-flight request.
- **`ctx.appExit` is launcher-owned** — booting the tui profile outside the `dsh` launcher fails loud at activation until the host provides the exit request.
