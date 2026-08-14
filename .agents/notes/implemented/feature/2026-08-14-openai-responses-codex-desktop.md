# Agent Note: OpenAI Responses controls and movable macOS packaging

Status: implemented

English | [中文](2026-08-14-openai-responses-codex-desktop.zh.md)

## Problem

An OpenAI API-key deployment needs more than changing a model name: first-party Responses continuation and reasoning controls have their own durable-history and privacy semantics. A desktop delivery also needs a closed production runtime rather than an undeclared dependency on the source checkout. Product-specific integrations must not return to every generic `dsh` installation and an account OAuth credential must not be silently treated as an OpenAI API key.

The desktop default, account OAuth, optional GPT route, delegation posture, and icon portions originally recorded here are superseded by the [Pi OAuth GPT desktop decision](2026-08-14-pi-oauth-gpt-desktop.md). This note owns the surviving generic Responses controls and movable macOS packaging closure.

## Decision

For a profile using `openai-responses`, `openAIResponses.store` enables server-side response storage. `previousResponseId` requires storage and continues only from the latest durable assistant response whose provider route, model, API, and response id match. The request sends `previous_response_id` and only the messages after that response, while the system prompt remains independently supplied. Foreign or incompatible history sends the complete durable conversation. `reasoningContext: all_turns` adds `reasoning.context`; reasoning effort, session-keyed prompt caching, cache retention, transport, tools, and replay metadata keep their separate owners. These fields do not apply to Chat Completions or pi-ai's ChatGPT OAuth backend.

The repository also ships an Apple-silicon desktop build path whose native AppKit launcher embeds Node, the built Harness web application, and a production dependency closure. It starts a private loopback server on an operating-system-assigned port, keeps the physical process cwd on APFS while assigning `/Volumes/sirui/deepseek-harness` as the preferred logical workspace, keeps deployment state and logs in the user's Library, terminates the child server on quit, and emits an ad-hoc-signed `deepseek harness.app` plus a metadata-free ZIP suitable for exFAT storage.

`apps/desktop-runtime/package.json` remains a deployment-only manifest. It carries the runtime closure without changing the generic `@deepseek-ai/dsh` application dependency graph. The builder materializes package-manager links as bytes before signing so the application can move outside the checkout. Current model defaults, OAuth, and icon behavior are defined by the superseding desktop note.

## Verification

Adapter tests pin first-party payload fields, the same-route history boundary, cache metadata, unsupported-protocol isolation, and the `previousResponseId`/`store` validation rule. Runtime-closure verification covers every workspace dependency reachable from the desktop manifest. Production build, native compilation, strict code-signature verification, property-list validation, zero-symlink scanning, and a real loopback startup cover the packaged artifact.

## Alternatives considered

**Restore product integrations to the generic production application.** This would make every CLI installation download optional product code and reverse the production dependency boundary. The deployment-only manifest keeps distribution cost local.

**Treat account OAuth as an API-key credential.** The authentication contracts, endpoints, refresh owners, and server-storage capabilities differ. Reusing private token files would couple Harness to another client's storage and could fail after refresh behavior changes.

**Use Chat Completions for compatibility.** It cannot carry the selected first-party response cursor and reasoning-context contract. The adapter applies these controls only to `openai-responses` descriptors.

**Run the App directly from exFAT.** AppleDouble metadata can invalidate the signed bundle. The installed application stays on APFS while the source checkout and ZIP may live on `/Volumes/sirui`.

## Consequences

API-key OpenAI routes can opt into provider-side response storage and compact cursor continuation with an explicit privacy posture. The desktop artifact is large because it embeds Node, web assets, and the production Harness closure, but it starts without global Node or pnpm and can move independently of the checkout. The packaging path does not choose the default model or authorize copying credentials across provider contracts.
