# DeepSeek Harness native distributions

English | [中文](README.zh.md)

DeepSeek Harness is available as a native Apple-silicon App, a macOS CLI, and self-contained Linux CLIs for x64 and ARM64. Every distribution runs the official DeepSeek Harness agent loop with its own Node.js runtime and production dependency closure. DeepSeek remains the default model; OpenAI GPT is an optional model provider inside the same Harness loop.

## One-command install

Run the same command on Apple-silicon macOS, Linux x64, or Linux ARM64:

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh
```

The installer detects the operating system and architecture, downloads the matching GitHub Release assets, verifies their SHA-256 checksums, and backs up an existing installation before replacement. It installs the shell command as `~/.local/bin/deepseek-harness`; make sure `~/.local/bin` is on `PATH`.

On macOS, the installer puts `DeepSeek Harness.app` in `/Applications` when writable, otherwise in `~/Applications`, and puts the CLI runtime in `~/Library/Application Support/DeepSeek Harness CLI`. On Linux, it puts the CLI runtime in `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness`.

## macOS App

The macOS build produces `DeepSeek Harness.app` and `deepseek-harness-macos-arm64.zip`. The App uses a normal native title bar, so its window can be dragged. Its icon is the official Harness black whale on a white rounded-square background. The builder removes Finder AppleDouble files before signing and replaces an old App bundle as a whole instead of merging files into it.

The App is ad-hoc signed rather than notarized. If macOS quarantines a downloaded build, use Finder's **Control-click → Open** flow for the first launch.

The App stores deployment state under `~/Library/Application Support/DeepSeek Harness` and writes its backend log to `~/Library/Logs/DeepSeek Harness/backend.log`. Use **DeepSeek Harness → Show backend log** to reveal the log and **View → Reload** to reload the web surface.

## CLI and Linux servers

The installed command is `deepseek-harness`. It is a terminal-native one-shot Harness entry point, not a separate Codex loop and not a persistent TUI. A plain task creates a persisted Harness session, prints the final answer, and exits. `web` starts the same browser surface used by the App.

```sh
deepseek-harness "inspect this repository and run the focused tests"
deepseek-harness web --host 127.0.0.1 --port 8080
deepseek-harness login
deepseek-harness status
deepseek-harness model
deepseek-harness model deepseek
deepseek-harness model gpt gpt-5.6-sol xhigh
deepseek-harness logout
```

The Linux archives are `deepseek-harness-linux-x64.tar.gz` and `deepseek-harness-linux-arm64.tar.gz`. Linux state defaults to `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness`; `DSH_HOME` overrides the state location on every platform.

For a headless server, use `deepseek-harness login device`. The CLI prints the device code and verification URL even when no browser, desktop session, or clipboard helper is available. Browser OAuth and OpenAI Platform API-key login remain available through `login browser` and `login api-key`; calling `login` without a method presents all three choices. An API key is read from hidden terminal input or standard input and never from a command-line argument.

Keep the Web UI bound to loopback because it does not provide public-edge authentication. To use it remotely, start `deepseek-harness web --host 127.0.0.1 --port 8080` and create an SSH tunnel from your computer:

```sh
ssh -L 8080:127.0.0.1:8080 user@server
```

Then open `http://127.0.0.1:8080` locally.

## DeepSeek default and optional OpenAI GPT

The shipped `deepseek-official/deepseek-v4-flash` route remains the primary-agent default. Selecting an OpenAI GPT model switches only the model provider used by the existing Harness main loop. It does not install Codex CLI, mount a Codex subagent, or replace the Harness agent loop.

ChatGPT browser and device-code login use pi-ai's native `openai-codex-responses` provider and OAuth refresh. The ChatGPT Codex backend requires `store: false`, so pi-ai handles continuation using that transport's supported mechanism. The API-key choice dispatches through pi-ai's standard OpenAI Responses provider and enables stored responses, durable `previous_response_id`, and `reasoning.context: "all_turns"`, while preserving the logical Harness route in replay metadata.

Harness continues to own its prompts, durable sessions, shell and patch tools, Skills, MCP, tool search, programmatic tool calls, and multi-agent orchestration. Those capabilities are not represented as OpenAI Hosted Shell calls. Claude Code is not installed or enabled by these profiles.

## Build and release

Use Node.js 24 and pnpm. Build macOS assets on Apple silicon:

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

Build a Linux archive natively on the target x64 or ARM64 host:

```sh
pnpm install --frozen-lockfile
pnpm run server:build
```

Pass `--output <directory>` after `--` to choose another output directory. Pushing a `deepseek-harness-v*` tag runs the GitHub Release workflow on native macOS ARM64, Linux x64, and Linux ARM64 runners, publishes all four archives plus `install.sh`, and generates `SHA256SUMS`.
