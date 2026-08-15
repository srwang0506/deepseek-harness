# Agent Note: The `$name` skill trigger — host-side invocation reusing the model's own injection path

Status: implemented

English | [中文](2026-08-15-dollar-skill-trigger.zh.md)

## Problem

The terminal had no user-side way to invoke a skill: only the model could load one by calling the `skill` tool, so a user who wanted a specific skill's instructions active had to ask the model to call it and hope. Codex's `$skill-name` prompt trigger closes exactly this gap, and the harness already owned the pieces — the `skill-invocation` message source, `renderSkillContent`, and the `ctx.skills` registry.

## Decision

**The `$name` token resolves to the same injection the `skill` tool performs.** The runner scans a submitted prompt for `$<kebab-case-name>` tokens (the public skill-name grammar), resolves each against `ctx.skills.get`, checks `isUserInvocable`, and injects a `createUserMessage` carrying `renderSkillContent(skill)` under the canonical `{ kind: 'skill-invocation', name, form: 'instructions' }` source before the follow-up. The model therefore sees exactly the `<skill_content>` shape the tool path produces, and the request log records the same provenance. Unknown or non-user-invocable names surface as an error row and are skipped, never aborting the turn.

**The trigger rides the existing inject-then-followup ordering** already used for `@path` mentions, so the skill body enters the next pre-step's context exactly once and wakes no extra turn.

## Consequences

`extractSkillInvocations` is exported and unit-covered (dedupe, order, digit-bearing segments, empty tokens). The PTY e2e seeds a flat Markdown skill under `$DSH_HOME/skills`, drives `$nope` (error row) then `$demo-skill` (invoked row), and asserts the skill body reached the model request. The tui bundle gains the `@deepseek-ai/dsh-skill` dependency and project reference; help and READMEs document the token.

## Alternatives considered

- **Making `$name` expand into a `skill` tool call** — that would need a synthetic tool-call round trip to reproduce what the injection already does directly; the tool stays the model's own gesture.
- **A slash command instead of a token** — `/skill name` splits the prompt flow; the token keeps the invocation inside the prompt line, matching Codex muscle memory and allowing several skills in one line.
- **A new message source** — `skill-invocation` already exists in `MessageSourceMap`; reusing it keeps provenance identical to the tool path.
