# Agent Note: Pi OAuth GPT models in DeepSeek-first native distributions

Status: implemented

English | [中文](2026-08-14-pi-oauth-gpt-desktop.zh.md)

## Problem

The native distributions should keep DeepSeek Harness as the agent runtime and DeepSeek as the default model while allowing GPT selection through eligible ChatGPT subscription access or an OpenAI Platform API key. Treating Codex CLI or Codex app-server as a subagent does not meet that requirement because it moves work into a second loop instead of changing the LLM used by Harness. The deliverable also needs a consistent product name, a draggable macOS App, server-ready Linux CLIs, and one GitHub installation path.

This decision supersedes the desktop default, OAuth, delegation, icon, and product-naming portions of the earlier [OpenAI Responses desktop decision](2026-08-14-openai-responses-codex-desktop.md). That note continues to own the generic API-key Responses controls and movable production dependency closure.

## Decision

Every user-facing distribution is named `DeepSeek Harness`; every CLI installs `deepseek-harness`. The macOS build emits `DeepSeek Harness.app`, a self-contained macOS CLI, and their ARM64 ZIP archives. A shared distribution builder deploys the production dsh closure, restores legacy-hoisted workspace packages, materializes package-manager links, copies the host-native Node.js executable, and rejects remaining symlinks. The Linux builder uses the same closure to emit native x64 and ARM64 tar archives. macOS state remains under `~/Library/Application Support/DeepSeek Harness`; Linux follows `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness`; `DSH_HOME` overrides both.

The macOS App generates its icon from the repository whale path as a black whale on a white rounded-square background. A normal AppKit title bar owns native window dragging. The bundle is sanitized of AppleDouble files, signed, and verified before archiving.

The composition retains `deepseek-official/deepseek-v4-flash` as the default and adds pi-ai's `openai-codex` catalog provider as an optional route. Selecting `openai-codex/gpt-5.6-sol` or another catalog GPT model changes only the LLM selected by the existing Harness main loop. Harness continues to own prompts, durable sessions, shell and patch tools, Skills, MCP, tool search, programmatic tool calls, and agent orchestration. The runtime neither embeds Codex CLI nor mounts a Codex subagent provider.

`dsh-llm-pi-ai` accepts an absolute top-level `credentialStorePath` and injects a persistent `CredentialStore` into immutable pi-ai `Models` snapshots. The store uses pi-ai's canonical credential shapes, owner-only modes, atomic full-document replacement, and a shared cross-process file lock. Pi owns provider OAuth resolution and token refresh. API keys retain the Harness credential-reference path and per-request override semantics; the native composition may additionally store a canonical API-key credential under its logical `openai-codex` route.

Interactive login remains composition-owned. The App pauses an unauthenticated `session.selectModel` request for `openai-codex` and offers ChatGPT browser OAuth, ChatGPT device-code OAuth, or an OpenAI Platform API key. The packaged CLI exposes the same choices through `deepseek-harness login`. On a headless Linux server, device login always prints the code and verification URL even when no GUI or clipboard helper is present. API keys are read over standard input and never appear in helper command-line arguments.

ChatGPT OAuth keeps pi-ai's `openai-codex-responses` implementation and `store: false` transport semantics. When the same logical route stores an API key, the adapter dispatches through pi-ai's standard `openai` Responses provider, enables stored responses, durable `previous_response_id`, and `reasoning.context: "all_turns"`, then records replay metadata under the original route and model. Both paths retain high reasoning, long cache retention, automatic transport selection, the Harness session id, and supported catalog reasoning levels.

A POSIX installer requires one explicit scenario: `macos-app`, `macos-cli`, `linux-x64`, or `linux-arm64`. Desktop and CLI installation are independent, and a scenario that does not match the host operating system and architecture fails before downloading an archive. Each path downloads only its GitHub Release asset, verifies it against `SHA256SUMS`, and backs up existing and legacy-named installations. CLI paths install a stable `~/.local/bin/deepseek-harness` link. A tag-triggered workflow builds all platforms on native GitHub-hosted runners and publishes the four archives, installer, and checksum manifest. The server Web surface remains loopback-only in documented usage and is reached remotely through an SSH tunnel.

## Verification

Credential-store tests cover API-key and OAuth persistence, private modes, concurrent writers, deletion, callback failure, and malformed documents. Adapter tests pin stored-key dispatch to `/v1/responses`, Responses controls, and logical replay identity. UI tests pin the pre-dispatch three-choice login and require selection to remain paused until authentication succeeds. Distribution tests pin the exact product and asset names, title-bar behavior, supported GitHub runners, Linux state path, headless OAuth output, required scenario selection, host mismatch rejection, App-only installation, and checksum-verified CLI installation against local fixture archives. macOS verification additionally covers native compilation, signing, AppleDouble removal, zero-symlink packaging, archive smokes, and a real loopback launch. GitHub Release jobs smoke the Linux artifacts on their native architectures.

## Alternatives considered

**Embed Codex as a subagent.** This runs another product's loop behind a delegation call and does not make GPT the model used by the DeepSeek Harness loop.

**Make GPT the distribution default.** DeepSeek-first is the required product posture. A missing OpenAI login must not break first use.

**Require an API key or reuse Codex CLI credentials.** Requiring a key excludes ChatGPT subscription access. Reusing another client's private credential files couples storage and refresh behavior. Pi's provider-owned OAuth flow keeps those concerns independent.

**Send an API key through the ChatGPT Codex transport.** That provider targets the subscription backend and declares OAuth authentication. The standard OpenAI provider is the correct public Responses API path for a Platform key.

**Cross-compile Linux from macOS.** The archive includes a host-native Node.js executable and native dependency closure, so native Linux x64 and ARM64 runners produce more trustworthy artifacts.

**Ship only source or an npm-global installer.** Those approaches require a server toolchain and expose package-manager layout differences. The release archives are self-contained and checksum-verified.

**Bind the Web UI publicly.** The bundled UI does not provide public-edge authentication. Loopback plus an SSH tunnel keeps remote use within the existing security boundary.

## Consequences

A fresh installation remains usable with DeepSeek before any OpenAI login. Selecting GPT presents three authentication methods and keeps every Harness-native capability in the same loop. ChatGPT and API-key requests intentionally use different transports and billing relationships while the selector preserves one logical route. macOS App users, macOS terminal users, Linux x64 servers, and Linux ARM64 servers share one release installer but choose separate scenario arguments; no scenario installs an unrelated surface. Runtime archives remain native builds. Existing targets are backed up instead of merged so signed bundles and self-contained runtimes are replaced atomically and remain recoverable.
