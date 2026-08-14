# DeepSeek Harness 原生发行版

[English](README.md) | 中文

DeepSeek Harness 提供 Apple 芯片原生 App、macOS CLI，以及 x64 和 ARM64 两种自包含 Linux CLI。每个发行包都用自带的 Node.js 运行时与生产依赖闭包运行官方 DeepSeek Harness agent loop。DeepSeek 继续作为默认模型，OpenAI GPT 是同一 Harness loop 内可选的模型提供方。

## 一条命令安装

Apple 芯片 macOS、Linux x64 与 Linux ARM64 使用同一条命令：

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh
```

安装器会自动识别操作系统与架构，从 GitHub Release 下载匹配的文件，校验 SHA-256，并在替换前备份已有安装。命令会安装为 `~/.local/bin/deepseek-harness`；请确保 `~/.local/bin` 已加入 `PATH`。

在 macOS 上，安装器会尽量把 `DeepSeek Harness.app` 放入 `/Applications`，目录不可写时改用 `~/Applications`；CLI 运行时放在 `~/Library/Application Support/DeepSeek Harness CLI`。在 Linux 上，CLI 运行时放在 `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness`。

## macOS App

macOS 构建会生成 `DeepSeek Harness.app` 和 `deepseek-harness-macos-arm64.zip`。App 使用普通原生标题栏，因此窗口可以拖动。图标是白色圆角底图上的官方 Harness 黑色小鲸鱼。构建器会在签名前移除 Finder AppleDouble 文件，并完整替换旧 App bundle，不会把新文件合并进旧目录。

App 使用 ad-hoc 签名，没有经过 Apple 公证。若下载后的构建被 macOS 隔离，首次启动请在 Finder 中按住 Control 点击 App，再选择“打开”。

App 把部署状态保存在 `~/Library/Application Support/DeepSeek Harness`，后端日志写入 `~/Library/Logs/DeepSeek Harness/backend.log`。可通过“DeepSeek Harness → 显示后端日志”定位日志，通过“显示 → 重新载入”刷新 Web 界面。

## CLI 与 Linux 服务器

安装后的命令是 `deepseek-harness`。它是终端原生的一次性 Harness 入口，不是另一套 Codex loop，也不是常驻 TUI。直接传入任务会创建持久化 Harness 会话，打印最终回答后退出；`web` 会启动与 App 相同的浏览器界面。

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

Linux 归档文件是 `deepseek-harness-linux-x64.tar.gz` 与 `deepseek-harness-linux-arm64.tar.gz`。Linux 状态默认保存在 `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness`；所有平台都可用 `DSH_HOME` 覆盖状态目录。

无桌面的服务器推荐使用 `deepseek-harness login device`。即使没有浏览器、桌面会话或剪贴板工具，CLI 也会打印设备码和验证网址。浏览器 OAuth 与 OpenAI Platform API-key 登录仍可分别通过 `login browser` 和 `login api-key` 使用；不指定方式调用 `login` 会显示全部三种选择。API key 从隐藏终端输入或标准输入读取，绝不会放在命令行参数中。

Web UI 不提供公网边缘认证，因此应只监听 loopback。远程使用时，先运行 `deepseek-harness web --host 127.0.0.1 --port 8080`，再从本机建立 SSH 隧道：

```sh
ssh -L 8080:127.0.0.1:8080 user@server
```

随后在本机打开 `http://127.0.0.1:8080`。

## 默认 DeepSeek 与可选 OpenAI GPT

发行包继续以 `deepseek-official/deepseek-v4-flash` 作为主 agent 默认路由。选择 OpenAI GPT 模型时，只会切换既有 Harness 主循环使用的模型提供方；它不会安装 Codex CLI、挂载 Codex subagent，或替换 Harness agent loop。

ChatGPT 浏览器与设备码登录使用 pi-ai 原生 `openai-codex-responses` 提供方及 OAuth 自动刷新。ChatGPT Codex 后端要求 `store: false`，因此 pi-ai 会使用该传输支持的机制续接。API-key 选择会通过 pi-ai 标准 OpenAI Responses 提供方分派，启用服务端响应存储、持久化 `previous_response_id` 与 `reasoning.context: "all_turns"`，同时在回放元数据中保留 Harness 逻辑路由。

提示词、持久会话、Shell 与补丁工具、Skills、MCP、工具搜索、程序化工具调用和多 Agent 编排仍由 Harness 拥有。这些能力不会伪装成 OpenAI Hosted Shell 调用。两个 profile 都不会安装或启用 Claude Code。

## 构建与发布

请使用 Node.js 24 与 pnpm。在 Apple 芯片机器上构建 macOS 文件：

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

在目标 x64 或 ARM64 Linux 主机上原生构建 Linux 归档：

```sh
pnpm install --frozen-lockfile
pnpm run server:build
```

在 `--` 后传入 `--output <目录>` 可指定其他输出目录。推送 `deepseek-harness-v*` tag 后，GitHub Release workflow 会在原生 macOS ARM64、Linux x64 与 Linux ARM64 runner 上构建，发布四个归档和 `install.sh`，并生成 `SHA256SUMS`。
