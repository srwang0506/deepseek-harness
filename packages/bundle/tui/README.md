# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh terminal-surface bundle: a Codex-style full-screen terminal client (Ink/React) over [`dsh-base`](../base/README.md). [`cordis.patch.yml`](cordis.patch.yml) supplies the coding persona and tool mode, disables HMR, and inserts this package's `tui-startup` provider, `tui-runner` plugin, and the model-facing `tool-ask-user` row (the TUI composition has no agent presets, so the question tool mounts here directly). It mounts no Host, HTTP server, Web runtime, or browser plugin.

The ordinary `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)) and parses this app's command line: the one-shot task positional (canonically `dsh exec "<task>"`, with bare `dsh "<task>"` kept as an alias; a bare `dsh exec` reads the task from piped stdin), `--resume <id>`, `--continue`, `--model <model>`, `--json`, `--jsonl` (a versioned stream: one `init` envelope, one `v`-stamped line per event, one `result` line), `--output-schema <schema>` (inline JSON or a file path; a mismatching final output exits 2), `-o/--output-file <path>`, `-i/--image <path>`, `--ephemeral`, and `--help`. The runner injects that service and reads the invocation from lazy config.

The runner ([`src/index.ts`](src/index.ts)) has two modes that share one `TerminalSessionController` ([`src/controller.ts`](src/controller.ts)), which owns agent adoption and disposal, the live event stream, and the approval/question answerers: submitting while a turn runs steers the agent at its next step boundary, Tab while a turn runs queues the line for the next turn (a `⇥ queued` status marker shows until the queue drains), ↑ on an empty composer opens the edit-message overlay — select a previous user message, edit it, and submitting forks the session from that message's turn (the fork persists through the session persistence backend, so the child resumes like any persisted session), and `shutdown()` cancels a running turn, flushes, disposes, and detaches. With a non-empty `task` it drives one fresh or resumed Agent through `ctx.agents`, waits for quiescence, flushes the Session, prints the last non-empty assistant text, and exits 0 for a completed final turn (1 otherwise). With no task it mounts a full-screen Ink app ([`src/ui/app.tsx`](src/ui/app.tsx)) over an observable store ([`src/ui/store.ts`](src/ui/store.ts)): it streams session events to the terminal (assistant text, reasoning, and diff-colored results; user rows render as `› ` (bold dim) and assistant/reasoning/tool rows as `• ` (dim), Codex-style, with the tool name labeling each call row and its result row as the card body and dim `─` turn separators (labeled `Local tools: N calls` for tool turns)), answers approvals inline as a closed y/n choice (Esc, Ctrl+D, or a turn cancel dismisses the request as cancelled), answers questions inline as preset numbers, typed custom answers, or multi-line free text (multi-select combines selected presets with typed text), resolves `@path` mentions to file content with Tab completion, opens a fuzzy project-file search when a line-start `@` is typed (type to filter, ↑/↓ select, Enter inserts the `@path` mention over the project-file index), edits the composer line through a cursor-aware engine with a Vim normal-mode subset (multi-line pastes insert verbatim and submit as one message; a coalesced trailing Enter still submits a single typed line) (Esc; `h`/`l`, `0`/`$`, `w`/`b`, `x`, `D`, `i`/`a`/`I`/`A`) and a visible block cursor, recalls submitted lines with ↑↓ prompt history, searches the submitted prompt history with `Ctrl+R` (a fuzzy overlay: type to filter, ↑/↓ select, Enter reuses the line), runs `!`-prefixed lines as local shell commands, loads user-defined prompt-template commands from `$DSH_HOME/commands/*.md`, invokes skills from `$name` tokens in a prompt (the skill's rendered instructions inject as a `skill-invocation` message, mirroring the model's own `skill` tool path), and handles the slash commands `/new`, `/fork`, `/delete [id]`, `/resume [id]`, `/sessions`, `/model [model]`, `/reasoning [effort]` (off/high/max; `default` clears), `/login [method]`, `/logout`, `/status`, `/permissions [preset]`, `/compact`, `/init`, `/doctor`, `/export`, `/diff`, `/review`, `/undo`, `/help`, `/quit`, and `/exit`; a bare `/resume` (and the launcher's `dsh resume`) opens a session picker that lists persisted sessions with folded titles — arrow keys move the highlight, Enter resumes, `f` forks the selection (persisted sessions load through the agents registry, fork, and dispose the source), Esc cancels — and `dsh resume --last` resumes the most recent session; `/status` reports the complete session state — identity, model and reasoning effort, sandbox mode with its workspace root, approval policy, permission preset, and live token usage — and `/permissions [preset]` shows or switches the session's permission preset (a durable session event, restored on resume); the first Ctrl+C cancels only the running turn, while Ctrl+D (like `/quit` and `/exit`) quits and flushes. The model selection is session-level: a resumed session restores the route from its folded `request/context` events and the reasoning effort from its last request header, and the bottom footer (a dim Codex-style line beneath the plain composer line) shows `? for shortcuts` — or the braille spinner while a turn runs — on the left, and the color-coded status line on the right: model (cyan), live token usage (green), git branch (magenta), the effective sandbox mode (magenta), with a `-m` launch override marked; the terminal window/tab title is set Codex-style (`dsh | <title-or-model> | <branch>`), updated when the session title is generated and cleared on exit; a fresh session opens with Codex's bordered title card (`>_ dsh (vX)`, the model with its reasoning effort, and the home-relativized directory, clamped to 56 columns and center-truncating long paths) followed by the Codex onboarding block (`To get started…`, then `/init`, `/status`, `/permissions`, `/model`, `/review` each indented with a ` - ` separator); subagent sessions whose parent chain reaches the live root render as labeled background rows (tool calls, final message, failures).; `/login` suspends the Ink surface to run the browser/device/API-key OpenAI GPT flow on the raw terminal. A resumed session replays its persisted transcript as styled Markdown before the prompt.

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
- **`/review` reviews inline** — the review prompt runs as an ordinary turn over this session's collected diffs; delegating it to a subagent through the continuable-subagent seam (so the review does not pollute the main conversation) is deferred until that seam exposes a terminal-friendly one-shot delegation.
- **The composer is a line editor, not Codex's composer editor** — ↑↓ history recall, `@path` Tab completion, the `@` fuzzy file search, the Vim motion subset, Tab queueing of the next turn, and editing a prior user message to fork from it are the current editing surface.
- **Permission classification is ask/never only** — Codex-style `untrusted` command-trust classification (auto-allowing low-risk read-only commands), multiple extra writable directories, and hook trust records are deferred; a prompt grant answers one operation, while a `/permissions` switch is the durable session policy.
- **`/status` does not list the instruction files in effect** — the agent-instructions plugin folds `AGENTS.md`/`CLAUDE.md` into the session log but exposes no registry to enumerate them; showing which files are live is deferred.
