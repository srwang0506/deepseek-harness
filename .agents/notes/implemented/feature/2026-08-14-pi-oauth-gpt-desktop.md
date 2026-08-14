# Agent Note: Pi OAuth GPT models in the DeepSeek-first desktop

Status: implemented

English | [中文](2026-08-14-pi-oauth-gpt-desktop.zh.md)

## Problem

The macOS distribution should keep DeepSeek Harness as the agent runtime and DeepSeek as its default model while allowing a user to select GPT models with either eligible ChatGPT subscription access or an OpenAI Platform API key. Treating Codex CLI or Codex app-server as a subagent does not meet that requirement: it moves work into a second agent loop instead of changing the LLM behind the existing Harness loop. Copying a Codex token into an API-key route would also bypass provider-owned refresh and credential semantics, while presenting only an API-key field would exclude subscription login.

This decision supersedes the desktop default, OAuth, delegation, and icon portions of the earlier [OpenAI Responses desktop decision](2026-08-14-openai-responses-codex-desktop.md). That note continues to own the generic API-key Responses controls and movable desktop packaging closure.

## Decision

The desktop composition retains `deepseek-official/deepseek-v4-flash` as the default and adds the installed pi-ai `openai-codex` catalog provider as an optional route. Selecting `openai-codex/gpt-5.6-sol` or another catalog GPT model changes only the LLM selected by the existing Harness main loop. Harness continues to own its prompt, durable session, shell and patch tools, Skills, MCP, tool search, programmatic tool calls, and agent orchestration. The desktop runtime no longer embeds Codex CLI or mounts a Codex subagent provider.

`dsh-llm-pi-ai` accepts an absolute top-level `credentialStorePath` and injects a persistent `CredentialStore` into every immutable pi-ai `Models` snapshot. The store uses pi-ai's canonical credential shapes, owner-only directory and file modes, atomic full-document replacement, and the shared cross-process file lock. Pi therefore owns provider OAuth resolution and runs token refresh inside the store's serialized `modify` operation. Ordinary API-key routes retain the Harness credential-reference path and per-request override semantics; the desktop may additionally store a canonical API-key credential under its logical `openai-codex` route.

Interactive login remains composition-owned. A document-start script in the AppKit `WKWebView` intercepts an unauthenticated `session.selectModel` request for `openai-codex`, pauses it, and offers ChatGPT browser OAuth, ChatGPT device-code OAuth, or an OpenAI Platform API key. The application menu opens the same chooser. The packaged CLI exposes the same three methods through `deeepseek-harness login`. A small bundled helper calls `Models.login('openai-codex', 'oauth', interaction)` for either OAuth mode or validates and stores an API key read over standard input; status reports the stored method and logout calls `Models.logout()`. It does not inspect or reuse Codex CLI files, and a key never appears in the helper's command-line arguments.

ChatGPT OAuth keeps pi-ai's `openai-codex-responses` model descriptors and provider implementation intact. The ChatGPT Codex backend uses `store: false`; the generic API-key Responses route's controls are not forced onto it. When the same logical route stores an API key, the adapter rebinds its selected model to pi-ai's standard `openai` Responses provider for dispatch, enables `store`, durable `previous_response_id`, and `reasoning.context: "all_turns"`, then records replay metadata under the original route and model. Both authentication paths retain high reasoning, long cache retention, automatic transport selection, the Harness session id, and the catalog's reasoning levels.

The application icon is generated from the repository whale path as a black whale on a white rounded-square background. The product and native bundle are named `DeeepSeek Harness`. A normal AppKit title bar, rather than a WebView-covered transparent title bar, owns reliable native window dragging. The state and log directories retain their earlier `DeepSeek Harness` name so an upgrade preserves settings, sessions, and credentials.

The macOS build also emits a self-contained `DeeepSeek Harness CLI` distribution. Its `deeepseek-harness` launcher reuses the packaged dsh runtime and the same pi provider, credential document, settings, and sessions as the App. A plain task invokes the shipped headless profile once and exits; `web` starts the browser surface; `login`, `status`, `logout`, and `model` are distribution-owned convenience commands. This is a terminal-native one-shot surface, not a persistent TUI and not a second agent implementation.

## Verification

Credential-store tests cover missing stores, API-key and OAuth persistence, private modes, concurrent writers, deletion, callback failure, and malformed documents. Configuration tests require an absolute store for OAuth-only routes without breaking providers that can still authenticate with API keys. Adapter tests pin the stored-key dispatch to `/v1/responses`, the first-party Responses controls, and logical replay identity. A jsdom test pins the pre-dispatch three-choice UI and verifies that model selection remains paused until authentication succeeds. CLI entry tests exercise its help and model-selection paths against a temporary shared home. Desktop closure, native compilation, application signing, AppleDouble removal, zero-symlink packaging, both archive smokes, and a real loopback launch cover the delivered artifacts.

## Alternatives considered

**Embed Codex as a subagent.** This runs another product's loop and tools behind a delegation call. It does not make GPT the model used by the DeepSeek Harness loop, so it was removed from the desktop composition.

**Make GPT the desktop default.** The requested product posture is DeepSeek-first with GPT as an opt-in selection. Overriding `agent-default-model` would make a missing OAuth login break first use and would erase that default.

**Require an API key.** An API key is a valid explicit choice, but requiring one would exclude ChatGPT subscription access and reproduce the misleading API-key-only login surface this decision corrects.

**Reuse a Codex CLI credential file.** Private Codex files would couple the Harness to another client's storage and refresh behavior. Pi's provider-owned OAuth flow and the desktop's canonical credential store keep the products independent.

**Send an API key through the ChatGPT Codex transport.** The `openai-codex` provider targets the subscription backend and declares OAuth authentication. Dispatching a stored key through pi-ai's standard `openai` provider preserves the visible Harness route while using the correct public Responses API.

**Reimplement the OpenAI wire protocol in the desktop launcher.** Pi already owns the model catalog, OAuth, refresh, transport, response replay, and compatibility behavior. A parallel client would split those facts and drift from the route used by the Harness adapter.

**Build a separate interactive CLI agent.** A new terminal agent loop would duplicate Harness session, tool, provider, and authentication behavior. Wrapping the official headless and Web profiles keeps the CLI on the same runtime; a persistent TUI can be designed separately if it becomes a requirement.

## Consequences

A fresh installation starts and remains usable with DeepSeek before any OpenAI login. Selecting GPT automatically presents the three authentication methods; after one succeeds, GPT remains a normal provider/model choice and every Harness-native capability stays in the same loop. The App and CLI share one secret-bearing file and model selection, so file permissions, standard-input key transfer, atomic writes, refresh locking, logout, and attributable login errors are part of their security boundary. ChatGPT and API-key requests intentionally use different transports and billing relationships even though the model selector keeps one logical route. Fresh bundle replacement and AppleDouble sanitation are required deployment invariants; copying into an existing signed App directory is unsupported.
