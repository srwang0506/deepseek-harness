# Agent Note: Tab queues the next turn — steering's sibling, separated at the controller

Status: implemented

English | [中文](2026-08-15-tab-queue-next-turn.zh.md)

## Problem

Codex's composer has two in-run submission paths: Enter injects into the current turn (steering), and Tab queues the line for the turn AFTER the current one settles. DSH had only the first — a submitted line during a run always steered — so a user could not prepare the next prompt while an agent was working.

## Decision

**Queue state lives in the controller, one slot.** `TerminalSessionController.queue(message)` stores the message and chains `agent.whenIdle()`: while the agent runs, the slot holds the message and `onQueueChange(true)` arms a `⇥ queued` status marker; when the current turn settles, the drain submits it as an ordinary followup and clears the marker. A new queue replaces the previous one; queueing while idle submits immediately; disposal clears the slot and the marker.

**Tab is the App-side trigger.** `applyComposerKey` resolves Tab (flag or the lone `\t` byte the PTY delivers as input text, including a tab coalesced onto a typed chunk) to a completion intent; the App routes it to `onQueue` when the store reports running and the line is non-empty, and to path completion otherwise. The runner pushes the queued line as a user row immediately — the line is already part of the conversation.

## Consequences

The controller's queue paths are unit-covered at 100% (queue-while-running + drain, replace, idle-immediate, dispose-clear, no-agent drop); the App branch and the `⇥ queued` marker render are covered by ui-render. No PTY scenario exists for the in-run Tab: the PTY driver's typed keys coalesce into one read chunk with the tab embedded, the mock's 8-character SSE chunks make any stream either shorter than the echo-wait protocol or minutes long, and the layer-appropriate tests above cover the semantics deterministically. Help text and READMEs document Tab queueing; the Known Limitations list drops it from the deferred composer work.

## Alternatives considered

- **A queue list instead of one slot** — Codex queues one next turn; a list invites ordering questions the product does not have yet, and a slot keeps the drain trivially race-free.
- **Queueing in the App state** — the queue must survive the turn boundary the controller owns; App-local state would need its own idle observation and could not be flushed at disposal.
