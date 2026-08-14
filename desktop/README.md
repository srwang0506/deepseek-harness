# deepseek harness for macOS

English | [中文](README.zh.md)

This directory owns the Apple-silicon desktop distribution. It wraps the official DeepSeek Harness web application in a native AppKit window, embeds its Node runtime and production dependency closure, and applies [`desktop.cordis.patch.yml`](desktop.cordis.patch.yml) at launch. The app is named **deepseek harness** and its icon uses the Harness black whale on a white rounded-square background.

## Install and launch

The build produces `deepseek harness.app` and `deepseek-harness-macos-arm64.zip`. Install the app in `/Applications`, then open it from Finder; the ZIP can remain on `/Volumes/sirui`. An expanded application should not run directly from an exFAT volume because macOS AppleDouble files can invalidate its bundle signature. The launcher keeps the backend's physical working directory on APFS while configuring `/Volumes/sirui/deepseek-harness` as the logical Harness workspace when that checkout exists; otherwise both fall back to the current user's home directory.

The distribution is ad-hoc signed rather than notarized. On a machine that quarantines the downloaded ZIP, use Finder's **Control-click → Open** flow for the first launch.

The app keeps deployment state under `~/Library/Application Support/DeepSeek Harness` and writes its backend log to `~/Library/Logs/DeepSeek Harness/backend.log`. Use **deepseek harness → Show backend log** to reveal it, and **View → Reload** to reload the web surface.

## DeepSeek default and optional OpenAI GPT

The shipped DeepSeek route and `deepseek-official/deepseek-v4-flash` remain the primary-agent default. The desktop patch adds the logical pi-ai route `openai-codex` as an optional model provider; it does not install Codex CLI, mount a Codex subagent, or replace the Harness agent loop.

Selecting an OpenAI GPT model when no OpenAI credential is configured automatically pauses the selection and offers three choices: ChatGPT browser OAuth, ChatGPT device-code OAuth, or an OpenAI Platform API key. Browser and device-code login use ChatGPT subscription access; the API-key choice uses separately billed Platform access. The application menu's **OpenAI sign in or switch method…** command opens the same chooser explicitly. **OpenAI login status** reports the stored method, and **Sign out of OpenAI** removes it.

OAuth tokens and API keys are stored in an owner-only JSON document below `~/Library/Application Support/DeepSeek Harness`; OAuth refreshes are serialized with a cross-process file lock. An API key passes from the password field to the native helper over standard input and never appears in its command-line arguments. After authentication succeeds, the paused `openai-codex` selection continues. The same Harness loop, local tools, prompts, sessions, and agent orchestration keep running; only the selected LLM provider changes.

## Pi OpenAI behavior

ChatGPT browser and device-code login use pi-ai's native `openai-codex-responses` implementation with OAuth refresh. ChatGPT's Codex backend requires `store: false`, so pi-ai handles continuation over its supported transport. An API key keeps the same visible `openai-codex` route and model selection but dispatches internally through pi-ai's standard OpenAI Responses provider; that path enables stored responses, durable `previous_response_id`, and `reasoning.context: "all_turns"`. Replay metadata preserves the logical route across that internal dispatch.

Both paths use high reasoning, long cache retention, automatic transport selection, the Harness session id, provider replay metadata, and the catalog's supported reasoning levels, including `xhigh` and `max` where the selected model offers them.

Harness-local shell, patch editing, Skills, MCP, tool search, programmatic tool calls, and multi-agent orchestration remain Harness capabilities. They are not represented as OpenAI Hosted Shell calls. Claude Code is intentionally not installed or enabled by this desktop profile.

## Build

From the repository root with Node.js 24 and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

Pass `--output <directory>` after `--` to choose another output directory. The builder performs a production deploy from [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json), restores legacy-hoisted workspace packages into that deploy, replaces package-manager links with movable bytes, compiles the native launcher, generates the icon, ad-hoc signs the bundle, and creates the ZIP.
