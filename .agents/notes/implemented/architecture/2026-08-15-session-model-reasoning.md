# Agent Note: Session-level model and reasoning selection — the session log is the source of truth

Status: implemented

English | [中文](2026-08-15-session-model-reasoning.zh.md)

## Problem

`/model` switched a mutable in-memory selection that vanished with the process: resuming a session continued with the configured default model instead of the model the session last used, and there was no terminal surface for the reasoning effort at all. A per-session choice needs a durable home, and settings.yaml is the wrong one — it is deployment/user defaults, not per-session state.

## Decision

**Restore from the session log, not from settings.** The session already records the durable facts: `request/context` events fold the latest provider/model route (`session.requestContext()`), and every `request/header` carries the exact `LlmCallConfig` including `reasoningEffort`. On resume the runner seeds its `ModelSelectionRef` from those two sources (`restoreSessionSelection`), so a resumed session continues with the model and effort it last used; the status bar shows the restored selection immediately.

**`/reasoning [effort]` switches the same mutable selection.** Bare `/reasoning` reports the current effort; an argument sets the adapter-owned effort (deepseek: `off`/`high`/`max`); `off`, `none`, or `default` clears it back to provider/default behavior. Like `/model`, the switch takes effect on the next turn and becomes durable through that turn's `request/header` — a switch with no following turn leaves no observable effect, matching the session log's "record what happened" semantics.

## Consequences

`restoreSessionSelection` is exported and unit-covered (route with effort, route without effort, request-less session). The PTY e2e drives `/reasoning high` and asserts the effort reaches the wire (`reasoning_effort: high` in the first request body), then clears it and completes a second turn. The status bar renders the effort suffix, and `slashNames`/help list `/reasoning`.

## Alternatives considered

- **A dedicated `session/model` event** — the route and effort are already durably logged per request (`request/context` + `request/header`), so a second record would duplicate state the log already owns; restoring from it keeps one source of truth and avoids a new `SessionEventMap` member with its ignorable-marker machinery.
- **Persisting the choice into settings.yaml** — settings are deployment/user defaults shared by every session; writing per-session state there would leak one session's choice into all others.
- **Applying the switch mid-turn** — the selection is captured at prompt assembly; a mid-turn switch would split the prompt from the request route, which `installModelSelection` explicitly prevents.
