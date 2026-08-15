# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh terminal-surface bundle: a Codex-style full-screen terminal client (Ink/React) over [`dsh-base`](../base/README.md). [`cordis.patch.yml`](cordis.patch.yml) supplies the coding persona and tool mode, disables HMR, and inserts this package's `tui-startup` provider, `tui-runner` plugin, and the model-facing `tool-ask-user` row (the TUI composition has no agent presets, so the question tool mounts here directly). It mounts no Host, HTTP server, Web runtime, or browser plugin.

The ordinary `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)) and parses this app's command line: the one-shot task positional (canonically `dsh exec "<task>"`, with bare `dsh "<task>"` kept as an alias), `--resume <id>`, `--continue`, `--model <model>`, `--json`, `--jsonl`, `-i/--image <path>`, `--ephemeral`, and `--help`. The runner injects that service and reads the invocation from lazy config.

The runner ([`src/index.ts`](src/index.ts)) has two modes that share one `TerminalSessionController` ([`src/controller.ts`](src/controller.ts)), which owns agent adoption and disposal, the live event stream, and the approval/question answerers: submitting while a turn runs steers the agent at its next step boundary, and `shutdown()` cancels a running turn, flushes, disposes, and detaches. With a non-empty `task` it drives one fresh or resumed Agent through `ctx.agents`, waits for quiescence, flushes the Session, prints the last non-empty assistant text, and exits 0 for a completed final turn (1 otherwise). With no task it mounts a full-screen Ink app ([`src/ui/app.tsx`](src/ui/app.tsx)) over an observable store ([`src/ui/store.ts`](src/ui/store.ts)): it streams session events to the terminal (assistant text, reasoning, tool calls, and results with diff coloring), answers approvals inline as a closed y/n choice (Esc, Ctrl+D, or a turn cancel dismisses the request as cancelled), answers questions inline as preset numbers, typed custom answers, or multi-line free text (multi-select combines selected presets with typed text), resolves `@path` mentions to file content with Tab completion, recalls submitted lines with ↑↓ prompt history, runs `!`-prefixed lines as local shell commands, loads user-defined prompt-template commands from `$DSH_HOME/commands/*.md`, and handles the slash commands `/new`, `/fork`, `/delete [id]`, `/resume [id]`, `/sessions`, `/model [model]`, `/login [method]`, `/logout`, `/status`, `/compact`, `/init`, `/doctor`, `/export`, `/diff`, `/review`, `/undo`, `/help`, `/quit`, and `/exit`; a bare `/resume` (and the launcher's `dsh resume`) opens a session picker that lists persisted sessions with folded titles — arrow keys move the highlight, Enter resumes, `f` forks the selection (persisted sessions load through the agents registry, fork, and dispose the source), Esc cancels — and `dsh resume --last` resumes the most recent session; the first Ctrl+C cancels only the running turn, while Ctrl+D (like `/quit` and `/exit`) quits and flushes. The status bar also shows live token usage from the token meter, and subagent sessions whose parent chain reaches the live root render as labeled background rows (tool calls, final message, failures).; `/login` suspends the Ink surface to run the browser/device/API-key OpenAI GPT flow on the raw terminal. A resumed session replays its persisted transcript as styled Markdown before the prompt.

Rendering is a set of pure, zero-dependency modules: [`src/theme.ts`](src/theme.ts) (ANSI), [`src/markdown.ts`](src/markdown.ts), [`src/highlight.ts`](src/highlight.ts), [`src/diff.ts`](src/diff.ts), and [`src/render.ts`](src/render.ts) (event dispatch).

## Model Experience

### Persona

#### What the model sees

One system-prompt sentence on every request: a coding-agent sentence naming the active model and the working directory. The same sentence the other surfaces use, with `{{model}}` and `{{cwd}}` templated per session.

#### Token effect

Small fixed input cost per request while the bundle is active.

#### KV Cache effect

Prefix-stable within a session while the model and working directory are unchanged; switching the model re-renders the sentence.

### Tool: ask_user_question

#### What the model sees

The model sees the generated [`ask_user_question` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ask-user). This bundle mounts the row itself because the TUI composition has no agent presets; the terminal answers it through the tui-runner's registered provider. The schema carries questions with a stable id, a question line, optional header/detail, optional preset options, and a multi-select flag.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

None beyond the row's stable catalog position; the tool adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **Streaming text is raw** — live chunk deltas stream unformatted; Markdown styling applies only to a resumed transcript's replay.
- **`/model` takes effect on the next step** — the mutable model selection is read at each step's prompt assembly, so a switch lands on the following turn, not the in-flight request.
- **`ctx.appExit` is launcher-owned** — booting the tui profile outside the `dsh` launcher fails loud at activation until the host provides the exit request.
