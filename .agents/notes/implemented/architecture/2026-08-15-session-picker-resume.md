# Agent Note: Session picker and `dsh resume` — one selection surface for resuming and forking persisted sessions

Status: implemented

English | [中文](2026-08-15-session-picker-resume.zh.md)

## Problem

The terminal client could resume sessions only by id (`--resume <id>`), by recency (`--continue`), or by a text listing (`/sessions`) whose rows could not be acted on. The launcher had no `resume` vocabulary at all, so reaching an older session meant finding its id first. Forking existed only for the live session (`/fork`); a persisted session could not be forked from the terminal even though the store's fork semantics already covered seeded lineage.

## Decision

**One picker surface, three entries.** A picker overlay in the TUI lists persisted sessions newest-first with titles folded from the session log (`ctx.sessionQuery.listSessions` + `readTitleSnapshots`, with `persistence.list()` as the fallback when no query service is mounted). It opens from a bare `/resume`, from the launcher's bare `dsh resume`, and (via the internal `--resume-picker` startup flag) as the whole first screen of `dsh resume`. Arrow keys move the highlight, Enter resumes the selection, `f` forks it, Esc cancels; with nothing persisted it falls back to a fresh session. The overlay replaces the input line and routes its keys before the ordinary `keyIntent` mapping through a pure `pickerIntent`.

**`dsh resume` is a launcher subcommand that maps onto existing tui flags.** `dsh resume --last` resolves to `--continue`, `dsh resume <id>` to `--resume <id>`, and bare `dsh resume` to `--resume-picker`; the tui startup gained only the one boolean flag.

**Fork-by-id loads the persisted source through the agents registry.** `forkSessionById` forks live sessions directly; for persisted ones it `agents.resume`s the source, forks from the live agent's session (preserving cwd and parent lineage through the store's seed semantics), and disposes the loaded handle so the source never leaks as a live entry.

## Consequences

`pickerSessions` and `forkSessionById` are exported and unit-covered; the picker key mapping is a pure `pickerIntent` with its own spec, and the overlay renders through the existing `UiStore` snapshot with an Ink round-border box. The PTY e2e now seeds sessions through `dsh exec` and drives two more scenarios: `dsh resume --last` replaying the most recent transcript, and bare `dsh resume` moving the highlight with an arrow key and resuming the older of two seeded sessions. The driver learned an `arrow` step that echo-waits like a typed key — an Enter written before the child reads the escape sequence coalesces into one chunk that Ink parses as a single arrow keypress and the trailing CR is lost.

## Alternatives considered

- **Picker as a separate Ink render tree** — a second render/unmount cycle per picker open; an overlay in the existing snapshot reuses the store, the status bar, and the quit path unchanged.
- **`dsh resume` resolving the id in the launcher** — the launcher has no persistence access; mapping to the tui app's existing `--continue`/`--resume` flags keeps the resolution where the services live.
- **Forking persisted sessions via `sessions.create(id, { seed })` + a store removal API** — no public removal exists; the agents-registry load-and-dispose path is the official seam and leaves no live residue.
