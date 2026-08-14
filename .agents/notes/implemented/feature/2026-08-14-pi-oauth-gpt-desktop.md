# Agent Note: Pi OAuth GPT models in the DeepSeek-first desktop

Status: implemented

English | [中文](2026-08-14-pi-oauth-gpt-desktop.zh.md)

## Problem

The macOS distribution should keep DeepSeek Harness as the agent runtime and DeepSeek as its default model while allowing a user with an eligible ChatGPT subscription to select GPT models. Treating Codex CLI or Codex app-server as a subagent does not meet that requirement: it moves work into a second agent loop instead of changing the LLM behind the existing Harness loop. Copying a Codex token into an API-key route would also bypass provider-owned refresh and credential semantics.

This decision supersedes the desktop default, OAuth, delegation, and icon portions of the earlier [OpenAI Responses desktop decision](2026-08-14-openai-responses-codex-desktop.md). That note continues to own the generic API-key Responses controls and movable desktop packaging closure.

## Decision

The desktop composition retains `deepseek-official/deepseek-v4-flash` as the default and adds the installed pi-ai `openai-codex` catalog provider as an optional route. Selecting `openai-codex/gpt-5.6-sol` or another catalog GPT model changes only the LLM selected by the existing Harness main loop. Harness continues to own its prompt, durable session, shell and patch tools, Skills, MCP, tool search, programmatic tool calls, and agent orchestration. The desktop runtime no longer embeds Codex CLI or mounts a Codex subagent provider.

`dsh-llm-pi-ai` accepts an absolute top-level `credentialStorePath` and injects a persistent `CredentialStore` into every immutable pi-ai `Models` snapshot. The store uses pi-ai's canonical credential shapes, owner-only directory and file modes, atomic full-document replacement, and the shared cross-process file lock. Pi therefore owns provider OAuth resolution and runs token refresh inside the store's serialized `modify` operation. API-key routes retain the Harness credential-reference path and per-request override semantics.

Interactive login remains composition-owned. The AppKit menu runs a small bundled helper that registers pi-ai's `openaiCodexProvider` and calls `Models.login('openai-codex', 'oauth', interaction)`; status calls `Models.getAuth()` and logout calls `Models.logout()`. The helper opens the provider authorization URL in the user's browser and writes the resulting credential to the same store used by the live Harness adapter. It does not inspect or reuse Codex CLI files.

The optional route keeps pi-ai's `openai-codex-responses` model descriptors and provider implementation intact. The desktop sets high reasoning, long cache retention, and automatic transport selection. Pi supplies the Harness session id and provider replay metadata to the backend and exposes the catalog's reasoning levels. The ChatGPT Codex backend uses `store: false`; the generic API-key Responses route's `store`, durable `previous_response_id`, and `reasoning.context` controls are not forced onto it.

The application icon is generated from the repository whale path as a black whale on a white rounded-square background. The app remains named `deepseek harness`.

## Verification

Credential-store tests cover missing stores, API-key and OAuth persistence, private modes, concurrent writers, deletion, callback failure, and malformed documents. Configuration tests require an absolute store for OAuth-only routes without breaking providers that can still authenticate with API keys. Existing adapter and catalog suites cover immutable snapshots, catalog-provider reuse, reasoning, replay, and request dispatch. Desktop closure, native compilation, application signing, zero-symlink packaging, and a real loopback launch cover the delivered artifact.

## Alternatives considered

**Embed Codex as a subagent.** This runs another product's loop and tools behind a delegation call. It does not make GPT the model used by the DeepSeek Harness loop, so it was removed from the desktop composition.

**Make GPT the desktop default.** The requested product posture is DeepSeek-first with GPT as an opt-in selection. Overriding `agent-default-model` would make a missing OAuth login break first use and would erase that default.

**Reuse an API key or Codex CLI credential file.** An API key requires separate metered API access, while private Codex files couple the Harness to another client's storage and refresh behavior. Pi's provider-owned OAuth flow and canonical credential store preserve the intended ChatGPT authentication contract.

**Reimplement the OpenAI wire protocol in the desktop launcher.** Pi already owns the model catalog, OAuth, refresh, transport, response replay, and compatibility behavior. A parallel client would split those facts and drift from the route used by the Harness adapter.

## Consequences

A fresh installation starts and remains usable with DeepSeek before any OpenAI login. GPT appears as a normal provider/model choice after the user completes OAuth, and every Harness-native capability stays in the same loop. The desktop now owns a secret-bearing file and browser login interaction, so file permissions, atomic writes, refresh locking, logout, and attributable login errors are part of its security boundary. ChatGPT backend behavior is whatever the installed pi-ai provider supports; it is not identical to the API-key OpenAI Responses route and must not be documented as server-stored continuation.
