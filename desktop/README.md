# DeeepSeek Harness for macOS and CLI

English | [中文](README.zh.md)

This directory owns the Apple-silicon desktop and command-line distributions. Both run the official DeepSeek Harness agent loop with an embedded Node runtime and production dependency closure. The App applies [`desktop.cordis.patch.yml`](desktop.cordis.patch.yml); one-shot CLI tasks apply [`cli.cordis.patch.yml`](cli.cordis.patch.yml). The product is named **DeeepSeek Harness**, and its icon uses the Harness black whale on a white rounded-square background.

## Install and launch the App

The build produces `DeeepSeek Harness.app` and `deeepseek-harness-macos-arm64.zip`. Install the App in `/Applications`, then open it from Finder. Replace an older bundle by moving the complete old bundle away before copying the new one; merging files into an existing App leaves stale signed resources and makes macOS report that the App is damaged. The builder removes Finder AppleDouble files before signing and uses a native, visible title bar so the window can be dragged normally.

The ZIP can remain on `/Volumes/sirui`, but an expanded application should not run directly from an exFAT volume because AppleDouble files can invalidate its bundle signature. The launcher keeps the backend's physical working directory on APFS while configuring `/Volumes/sirui/deepseek-harness` as the logical Harness workspace when that checkout exists; otherwise both fall back to the current user's home directory.

The distribution is ad-hoc signed rather than notarized. On a machine that quarantines the downloaded ZIP, use Finder's **Control-click → Open** flow for the first launch.

The App keeps deployment state under `~/Library/Application Support/DeepSeek Harness` and writes its backend log to `~/Library/Logs/DeepSeek Harness/backend.log`. Those existing directory names deliberately remain unchanged so upgrading to **DeeepSeek Harness** preserves settings, sessions, and credentials. Use **DeeepSeek Harness → Show backend log** to reveal the log, and **View → Reload** to reload the web surface.

## Install and use the CLI

The same build produces the directory `DeeepSeek Harness CLI` and `deeepseek-harness-cli-macos-arm64.zip`. Keep the entire expanded directory together and place its `bin` directory on `PATH`, or link the launcher into a directory already on `PATH`:

```sh
ln -s "/path/to/DeeepSeek Harness CLI/bin/deeepseek-harness" ~/.local/bin/deeepseek-harness
deeepseek-harness --help
```

The CLI is a terminal-native one-shot Harness entry point, not a separate Codex loop and not a persistent TUI. A plain task creates a fresh persisted Harness session, prints the final answer, and exits. `web` starts the same browser surface used by the App.

```sh
deeepseek-harness "inspect this repository and run the focused tests"
deeepseek-harness web
deeepseek-harness login
deeepseek-harness status
deeepseek-harness model
deeepseek-harness model deepseek
deeepseek-harness model gpt gpt-5.6-sol xhigh
deeepseek-harness logout
```

Calling `login` with no method opens a terminal chooser with the same three choices as the App. Automation can select `login browser`, `login device`, or `login api-key` explicitly; an API key is read from hidden terminal input or standard input, never a command-line argument. The App and CLI share the unchanged `~/Library/Application Support/DeepSeek Harness` home, so model selection, sessions, and OpenAI credentials remain consistent between them.

## DeepSeek default and optional OpenAI GPT

The shipped DeepSeek route and `deepseek-official/deepseek-v4-flash` remain the primary-agent installation default. The desktop and CLI patches add the logical pi-ai route `openai-codex` as an optional model provider; they do not install Codex CLI, mount a Codex subagent, or replace the Harness agent loop.

Selecting an OpenAI GPT model in the App when no OpenAI credential is configured automatically pauses the selection and offers ChatGPT browser OAuth, ChatGPT device-code OAuth, or an OpenAI Platform API key. Browser and device-code login use eligible ChatGPT subscription access; the API-key choice uses separately billed Platform access. The application menu's **OpenAI sign in or switch method…** command opens the same chooser explicitly. **OpenAI login status** reports the stored method, and **Sign out of OpenAI** removes it.

OAuth tokens and API keys are stored in an owner-only JSON document below `~/Library/Application Support/DeepSeek Harness`; OAuth refreshes are serialized with a cross-process file lock. An API key passes from the password field or CLI prompt to the helper over standard input and never appears in its command-line arguments. After authentication succeeds, the paused `openai-codex` selection continues. The same Harness loop, local tools, prompts, sessions, and agent orchestration keep running; only the selected LLM provider changes.

## Pi OpenAI behavior

ChatGPT browser and device-code login use pi-ai's native `openai-codex-responses` implementation with OAuth refresh. ChatGPT's Codex backend requires `store: false`, so pi-ai handles continuation over its supported transport. An API key keeps the same visible `openai-codex` route and model selection but dispatches internally through pi-ai's standard OpenAI Responses provider; that path enables stored responses, durable `previous_response_id`, and `reasoning.context: "all_turns"`. Replay metadata preserves the logical route across that internal dispatch.

Both paths use high reasoning, long cache retention, automatic transport selection, the Harness session id, provider replay metadata, and the catalog's supported reasoning levels, including `xhigh` and `max` where the selected model offers them.

Harness-local shell, patch editing, Skills, MCP, tool search, programmatic tool calls, and multi-agent orchestration remain Harness capabilities. They are not represented as OpenAI Hosted Shell calls. Claude Code is intentionally not installed or enabled by these profiles.

## Build

From the repository root with Node.js 24 and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

Pass `--output <directory>` after `--` to choose another output directory. The builder performs a production deploy from [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json), restores legacy-hoisted workspace packages into that deploy, replaces package-manager links with movable bytes, compiles the native launcher, generates the icon, removes AppleDouble metadata, ad-hoc signs and verifies the App, and creates both App and CLI ZIPs.
