# deepseek harness for macOS

English | [中文](README.zh.md)

This directory owns the Apple-silicon desktop distribution. It wraps the official DeepSeek Harness web application in a native AppKit window, embeds its Node runtime and production dependency closure, and applies [`openai.cordis.patch.yml`](openai.cordis.patch.yml) at launch. The app is named **deepseek harness** and its icon is rendered from the repository's official blue DeepSeek whale on a black rounded square.

## Install and launch

The build produces `deepseek harness.app` and `deepseek-harness-macos-arm64.zip`. Copy the app to `/Volumes/sirui` or `/Applications`, then open it from Finder. The launcher uses `/Volumes/sirui` as the workspace when that volume is mounted and otherwise falls back to the current user's home directory.

The distribution is ad-hoc signed rather than notarized. On a machine that quarantines the downloaded ZIP, use Finder's **Control-click → Open** flow for the first launch.

The app keeps deployment state under `~/Library/Application Support/DeepSeek Harness` and writes its backend log to `~/Library/Logs/DeepSeek Harness/backend.log`. Use **deepseek harness → Show backend log** to reveal it, and **View → Reload** to reload the web surface.

## OpenAI and Codex authentication

The primary agent route is OpenAI Responses with `openai/gpt-5.6-sol`. It requires an OpenAI API credential supplied as `OPENAI_API_KEY` in the launching environment or stored through the Harness credential surface under that reference.

The app separately embeds the official `@openai/codex` CLI and mounts the Harness `codex` subagent provider. Use **deepseek harness → Codex account login…** to run the official ChatGPT/Codex OAuth flow; **Codex login status** reports its state. Once signed in, the model can delegate through the `subagent_codex` tool and Codex runs through its official app-server protocol.

These are deliberately separate credential lanes: a ChatGPT/Codex account login authorizes Codex, but it is not copied or repurposed as the API key for the primary Responses model.

## Native Responses behavior

The desktop patch enables server-side response storage, same-route `previous_response_id` continuation, `reasoning.context: all_turns`, `reasoning.effort: high`, SSE transport, long prompt-cache retention, and the Harness session id as the prompt-cache key. The underlying model catalog continues to expose supported `xhigh` and `max` reasoning levels when the selected model provides them.

Harness-local shell, patch editing, Skills, MCP, tool search, programmatic tool calls, and multi-agent orchestration remain Harness capabilities. They are not represented as OpenAI Hosted Shell calls. Claude Code is intentionally not installed or enabled by this desktop profile.

## Build

From the repository root with Node.js 24 and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

Pass `--output <directory>` after `--` to choose another output directory. The builder performs a production deploy from [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json), restores legacy-hoisted workspace packages into that deploy, replaces package-manager links with movable bytes, compiles the native launcher, generates the icon, ad-hoc signs the bundle, and creates the ZIP.
