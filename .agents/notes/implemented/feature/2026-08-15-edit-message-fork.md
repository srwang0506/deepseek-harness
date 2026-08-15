# Agent Note: Edit a previous user message and fork the session from its turn

Status: implemented

English | [中文](2026-08-15-edit-message-fork.zh.md)

## Problem

Codex lets the user step back to any previous user message, edit it, and re-run the conversation from there — the classic branch-and-rewrite interaction. DSH's composer had no path to it, and the fork mechanics had a latent bug: every fork-adoption route (`/fork`, the picker's `f`, and this new edit flow) forked through `ctx.sessions.fork`, which produces a LIVE child that no agent-adoption path can take over (agent creation and resume both refuse live sessions through the persistence `prepare` check), so `/fork` on a live session had never actually worked end to end.

## Decision

**Fork through the persistence backend, never the live store.** `forkSessionById` now snapshots the source's event prefix (bounded by an inclusive seq) and persists the child with `sessionPersistence.create(meta)` + `append(id, seed)` — the detached-session write path. The child is never live, so `controller.replace(childId)` resumes it through the ordinary persistence path like any other session. An empty seed throws loudly: an empty child would never materialize an artifact.

**↑ on an empty composer opens the edit overlay.** The overlay lists the session's `user/message` events (source `user`) newest first; Enter loads one into the composer and records its fork boundary — the event seq just BEFORE the message's own `turn/start` — because a fork may not end inside an open turn, and the edited message replaces its whole turn. Submitting routes to `onSubmitEdit`: fork at the boundary, replace the live agent with the child, replay, and submit the edited text as the child's first turn. A message in the first turn (boundary -1) replaces the session with a fresh one.

## Consequences

`overlay.ts`'s edit-overlay reducer and the fork-boundary fold are unit-covered at 100%; `picker.spec.ts` now proves the fork persists through the JSONL backend with `parentSession` lineage and the boundary cutting the seed correctly. The PTY e2e edits the second message, forks, and asserts the edited text is the child's first request while a `parentSession`-linked artifact persists. The same persistence-path fork now also fixes the pre-existing `/fork` and picker-fork adoption (they share `forkSessionById`). Help text and READMEs document the interaction; the Known Limitations list drops edit-and-fork from the deferred composer work.

## Alternatives considered

- **A live-store detach/retire seam** — the fork child's live entry is fiber-owned with no public detach, so adoption would need a new core lifecycle API; the persistence write path already exists and makes the child resumable with zero core changes.
- **Forking mid-turn at the message seq** — the session store rejects boundaries inside an open turn (`OPEN_TURN`); boundary = the preceding `turn/start - 1` keeps the seed a complete transcript and lets the edited message replace its turn.
