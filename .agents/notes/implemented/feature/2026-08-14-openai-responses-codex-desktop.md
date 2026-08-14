# Agent Note: OpenAI Responses desktop distribution with Codex delegation

Status: implemented

English | [中文](2026-08-14-openai-responses-codex-desktop.zh.md)

## Problem

An OpenAI-first macOS deployment needs more than changing the default model name. The primary loop must retain first-party Responses continuation and reasoning controls, the optional Codex account path must use the official login and app-server lifecycle, and the delivered application must carry a closed production runtime instead of depending on the source checkout. Adding product integrations back to every `dsh` install would contradict the [production dependency boundary](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md), while treating a Codex OAuth credential as a general OpenAI API key would cross an authentication boundary the official clients keep separate.

## Decision

The repository ships an Apple-silicon desktop build path whose native AppKit launcher embeds Node, the built Harness web application, a production dependency closure, the official Codex CLI, and an OpenAI-first Cordis patch. It starts a private loopback web server on an operating-system-assigned port, uses `/Volumes/sirui` as the preferred workspace, keeps deployment state and logs in the user's Library, terminates its child server when the application quits, and is packaged as the ad-hoc-signed `deepseek harness.app` plus a ZIP.

`apps/desktop-runtime/package.json` is a deployment-only manifest. It includes the Codex provider and its runtime closure without changing the generic `@deepseek-ai/dsh` application dependency graph. At launch, the application maintains one profile-local symlink from the desktop DSH home to the bundled Codex provider so normal Profile resolution can find that explicitly installed integration. A pre-existing non-symlink at that path is preserved and startup fails with an attributable error instead of replacing user state. This deployment-specific opt-in complements rather than supersedes the generic production exclusion decision.

The primary agent uses the pi-ai OpenAI route and requires the `OPENAI_API_KEY` credential reference. For `openai-responses` models, `openAIResponses.store` enables server-side storage; `previousResponseId` requires storage and continues only from the latest durable assistant response whose provider route, model, API, and response id match. The request then sends `previous_response_id` and only the messages after that assistant response, while the system prompt remains independently supplied. A foreign or incompatible assistant response sends full durable history. `reasoningContext: all_turns` adds `reasoning.context`, while existing reasoning effort, session-keyed prompt caching, cache retention, transport, tools, and replay metadata keep their separate owners.

Codex is an optional foreground subagent exposed as `subagent_codex`, following the existing [Codex provider contract](2026-08-04-claude-code-and-codex-subagent-backends.md). The application menu invokes the bundled official CLI for login and status, and the provider communicates with the official Codex app-server. Harness does not read, copy, convert, or refresh the resulting OAuth token for the primary Responses route. Claude Code is absent from this desktop runtime and patch.

The application icon is generated at build time from the repository's official DeepSeek favicon path, using the official blue on a black rounded-square background. The builder materializes package-manager links as bytes before signing so the application remains movable outside the checkout.

## Verification

Adapter tests pin the first-party payload fields, same-route history boundary, cache metadata, unsupported-protocol isolation, and the `previousResponseId`/`store` validation rule. The runtime-closure verifier proves every workspace dependency reachable from the desktop manifest is declared. A production build, strict code-signature verification, property-list validation, zero-symlink scan, embedded CLI smoke tests, and a real loopback web startup cover the packaged artifact.

## Alternatives considered

**Restore Codex and Claude Code to the generic production application.** This would make every CLI installation download optional product code and would reverse the production dependency decision. The separate desktop manifest pays that cost only for this distribution and includes Codex alone.

**Use the Codex OAuth login as the primary OpenAI model credential.** The Codex client owns login, refresh, and app-server authentication; the Responses API key route owns a different contract. Reusing token files would couple the Harness to private credential storage and could silently stop refreshing, so the two lanes stay explicit.

**Route every GPT request through Codex.** This would expose only delegation semantics and would not give the main Harness loop direct ownership of its model selection, durable history, Responses continuation, prompt-cache key, or native tool loop. Codex remains a callable specialist beside the direct OpenAI adapter.

**Use Chat Completions for compatibility.** It cannot carry the first-party response cursor and reasoning-context contract selected for this deployment. The adapter applies the new controls only when the catalog model resolves to `openai-responses` and leaves other protocols unchanged.

## Consequences

The desktop artifact is large because it embeds Node, the full production Harness closure, web assets, and Codex platform binaries, but it starts without a global Node or pnpm installation and can move independently of the checkout. The main model still requires billable OpenAI API access even when the user has a ChatGPT/Codex subscription. Server-side storage becomes part of the configured OpenAI privacy posture when cursor continuation is enabled. Harness tools such as local shell, patch editing, Skills, MCP, tool search, programmatic tool calls, and multi-agent orchestration remain Harness-native capabilities rather than OpenAI Hosted Shell calls.
