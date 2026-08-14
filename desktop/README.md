# deepseek harness for macOS

English | [中文](README.zh.md)

This directory owns the Apple-silicon desktop distribution. It wraps the official DeepSeek Harness web application in a native AppKit window, embeds its Node runtime and production dependency closure, and applies [`desktop.cordis.patch.yml`](desktop.cordis.patch.yml) at launch. The app is named **deepseek harness** and its icon uses the Harness black whale on a white rounded-square background.

## Install and launch

The build produces `deepseek harness.app` and `deepseek-harness-macos-arm64.zip`. Install the app in `/Applications`, then open it from Finder; the ZIP can remain on `/Volumes/sirui`. An expanded application should not run directly from an exFAT volume because macOS AppleDouble files can invalidate its bundle signature. The launcher keeps the backend's physical working directory on APFS while configuring `/Volumes/sirui/deepseek-harness` as the logical Harness workspace when that checkout exists; otherwise both fall back to the current user's home directory.

The distribution is ad-hoc signed rather than notarized. On a machine that quarantines the downloaded ZIP, use Finder's **Control-click → Open** flow for the first launch.

The app keeps deployment state under `~/Library/Application Support/DeepSeek Harness` and writes its backend log to `~/Library/Logs/DeepSeek Harness/backend.log`. Use **deepseek harness → Show backend log** to reveal it, and **View → Reload** to reload the web surface.

## DeepSeek default and optional OpenAI OAuth

The shipped DeepSeek route and `deepseek-official/deepseek-v4-flash` remain the primary-agent default. The desktop patch adds the pi-ai catalog route `openai-codex` as an optional model provider; it does not install Codex CLI, mount a Codex subagent, or replace the Harness agent loop.

Use **deepseek harness → OpenAI OAuth sign in…** to open pi-ai's ChatGPT subscription OAuth flow. **OpenAI OAuth status** checks and refreshes the stored credential when necessary; **Sign out of OpenAI OAuth** removes it. Tokens are stored in an owner-only JSON document below `~/Library/Application Support/DeepSeek Harness` and refreshes are serialized with a cross-process file lock.

After sign-in, choose an `openai-codex` GPT model such as `gpt-5.6-sol` in the normal Harness model selector. The same Harness loop, local tools, prompts, sessions, and agent orchestration continue to run; only the selected LLM provider changes.

## Pi OpenAI behavior

The optional route uses pi-ai's native `openai-codex-responses` implementation with high reasoning, long cache retention, automatic transport selection, the Harness session id, provider replay metadata, OAuth refresh, and the model catalog's supported reasoning levels (including `xhigh` and `max` where available). ChatGPT's Codex backend requires `store: false`; pi-ai handles continuation over its supported transport rather than applying the API-key Responses route's server-storage controls.

Harness-local shell, patch editing, Skills, MCP, tool search, programmatic tool calls, and multi-agent orchestration remain Harness capabilities. They are not represented as OpenAI Hosted Shell calls. Claude Code is intentionally not installed or enabled by this desktop profile.

## Build

From the repository root with Node.js 24 and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

Pass `--output <directory>` after `--` to choose another output directory. The builder performs a production deploy from [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json), restores legacy-hoisted workspace packages into that deploy, replaces package-manager links with movable bytes, compiles the native launcher, generates the icon, ad-hoc signs the bundle, and creates the ZIP.
