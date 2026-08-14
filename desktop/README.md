# DeepSeek Harness native distributions

English | [中文](README.zh.md)

DeepSeek Harness is available as a native Apple-silicon App, a macOS CLI, self-contained Linux CLIs for x64 and ARM64, and Windows CLIs for x64 and ARM64. Every distribution runs the official DeepSeek Harness agent loop with its own Node.js runtime and production dependency closure. DeepSeek remains the default model; OpenAI GPT is an optional model provider inside the same Harness loop.

## Choose an installation

Choose exactly one target. The installer rejects an omitted target or a target that does not match the current operating system and architecture. Every target downloads only its own GitHub Release archive, verifies its SHA-256 checksum, and backs up an existing installation before replacement.

### macOS desktop App

Use this on an Apple-silicon Mac when you want the graphical App. It does not install the CLI:

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- macos-app
```

The App is installed in `/Applications` when writable, otherwise in `~/Applications`.

### macOS CLI

Use this on an Apple-silicon Mac when you want terminal access. It does not install the desktop App:

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- macos-cli
```

The runtime is installed in `~/Library/Application Support/DeepSeek Harness CLI` and linked as `~/.local/bin/dsh`.

### Linux x64 server

Use this on an `x86_64` Linux server:

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- linux-x64
```

### Linux ARM64 server

Use this on an `aarch64` or `arm64` Linux server:

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- linux-arm64
```

Both Linux targets install the runtime in `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness` and link `~/.local/bin/dsh`. Make sure `~/.local/bin` is on `PATH` before invoking the command by name.

### Windows x64

Use this on `x64` Windows:

```powershell
irm https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.ps1 | iex windows-x64
```

### Windows ARM64

Use this on `arm64` Windows:

```powershell
irm https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.ps1 | iex windows-arm64
```

Both Windows targets install the runtime in `%LOCALAPPDATA%\DeepSeek Harness CLI` and link `%LOCALAPPDATA%\DeepSeek Harness\bin\dsh.cmd`. Make sure `%LOCALAPPDATA%\DeepSeek Harness\bin` is on `PATH` before invoking the command by name.

## macOS App

The macOS build produces `DeepSeek Harness.app` and `deepseek-harness-macos-arm64.zip`. The App uses a normal native title bar, so its window can be dragged. Its icon is the official Harness black whale on a white rounded-square background. The builder removes Finder AppleDouble files before signing and replaces an old App bundle as a whole instead of merging files into it.

The App is ad-hoc signed rather than notarized. If macOS quarantines a downloaded build, use Finder's **Control-click → Open** flow for the first launch.

The App stores deployment state under `~/Library/Application Support/DeepSeek Harness` and writes its backend log to `~/Library/Logs/DeepSeek Harness/backend.log`. Use **DeepSeek Harness → Show backend log** to reveal the log and **View → Reload** to reload the web surface.

## CLI

The installed command is `dsh`, the Codex-style interactive terminal client. Bare `dsh` opens a full-screen session; `dsh "task"` runs one task and exits; `dsh web` starts the same browser surface used by the App.

```sh
dsh
dsh "inspect this repository and run the focused tests"
dsh web --host 127.0.0.1 --port 8080
dsh login
dsh status
dsh model
dsh model deepseek
dsh model gpt gpt-5.6-sol xhigh
dsh logout
```

The Linux archives are `deepseek-harness-linux-x64.tar.gz` and `deepseek-harness-linux-arm64.tar.gz`; the Windows archives are `deepseek-harness-windows-x64.zip` and `deepseek-harness-windows-arm64.zip`. Linux state defaults to `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness` and Windows state to `%LOCALAPPDATA%\DeepSeek Harness`; `DSH_HOME` overrides the state location on every platform.

For a headless server, use `dsh login device`. The CLI prints the device code and verification URL even when no browser, desktop session, or clipboard helper is available. Browser OAuth and OpenAI Platform API-key login remain available through `login browser` and `login api-key`; calling `login` without a method presents all three choices. An API key is read from hidden terminal input or standard input and never from a command-line argument.

Keep the Web UI bound to loopback because it does not provide public-edge authentication. To use it remotely, start `dsh web --host 127.0.0.1 --port 8080` and create an SSH tunnel from your computer:

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

Build a Windows archive natively on the target x64 or ARM64 host:

```powershell
pnpm install --frozen-lockfile
pnpm run windows:build
```

Pass `--output <directory>` after `--` to choose another output directory. Pushing a `deepseek-harness-v*` tag runs the GitHub Release workflow on native macOS ARM64, Linux x64, Linux ARM64, and Windows x64 runners, publishes all archives plus `install.sh` and `install.ps1`, and generates `SHA256SUMS`.
