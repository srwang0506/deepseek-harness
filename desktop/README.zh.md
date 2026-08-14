# DeeepSeek Harness macOS 与 CLI 版

[English](README.md) | 中文

本目录维护 Apple 芯片版桌面和命令行发行包。两者都通过内置 Node 运行时与生产依赖闭包运行官方 DeepSeek Harness agent loop。App 应用 [`desktop.cordis.patch.yml`](desktop.cordis.patch.yml)，CLI 的一次性任务应用 [`cli.cordis.patch.yml`](cli.cordis.patch.yml)。产品名称是 **DeeepSeek Harness**，图标使用白色圆角底图与 Harness 黑色小鲸鱼。

## 安装与启动 App

构建会生成 `DeeepSeek Harness.app` 和 `deeepseek-harness-macos-arm64.zip`。请把 App 安装到 `/Applications`，再从 Finder 打开。更新旧版时，应先完整移走旧 App，再复制新 App；如果把新文件合并进已有 App，旧的签名资源会残留，macOS 就会报告 App 已损坏。构建器会在签名前移除 Finder AppleDouble 文件，并使用原生可见标题栏，让窗口可以正常拖动。

ZIP 可以继续保存在 `/Volumes/sirui`，但不要直接从 exFAT 卷运行解压后的 App，因为 AppleDouble 文件可能使 bundle 签名失效。启动器会让后端进程的实际工作目录留在 APFS；若 `/Volumes/sirui/deepseek-harness` checkout 存在，则把它独立配置为 Harness 的逻辑工作区，否则两者都回退到当前用户的主目录。

发行包使用 ad-hoc 签名，没有经过 Apple 公证。若从 ZIP 解压后被系统隔离，首次启动请在 Finder 中按住 Control 点击 App，再选择“打开”。

App 把部署状态保存在 `~/Library/Application Support/DeepSeek Harness`，后端日志写入 `~/Library/Logs/DeepSeek Harness/backend.log`。这些既有目录名刻意保持不变，因此升级到 **DeeepSeek Harness** 时会保留设置、会话和凭据。可通过“DeeepSeek Harness → 显示后端日志”定位日志，通过“显示 → 重新载入”刷新 Web 界面。

## 安装与使用 CLI

同一次构建还会生成目录 `DeeepSeek Harness CLI` 和 `deeepseek-harness-cli-macos-arm64.zip`。请完整保留解压后的目录，并把其中的 `bin` 加入 `PATH`；也可以把启动器链接到已经位于 `PATH` 的目录：

```sh
ln -s "/path/to/DeeepSeek Harness CLI/bin/deeepseek-harness" ~/.local/bin/deeepseek-harness
deeepseek-harness --help
```

CLI 是终端原生的一次性 Harness 入口，不是另一套 Codex loop，也不是常驻 TUI。直接传入任务会新建并持久化一条 Harness 会话，打印最终回答后退出；`web` 会启动与 App 相同的浏览器界面。

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

不带方式调用 `login` 时，终端会显示与 App 相同的三选一界面。自动化场景可显式调用 `login browser`、`login device` 或 `login api-key`；API key 从隐藏的终端输入或标准输入读取，绝不作为命令行参数传递。App 与 CLI 共用未改名的 `~/Library/Application Support/DeepSeek Harness` home，因此模型选择、会话与 OpenAI 凭据会在两者之间保持一致。

## 默认 DeepSeek 与可选 OpenAI GPT

发行包保留官方 DeepSeek 路由，并继续以 `deepseek-official/deepseek-v4-flash` 作为主 agent 的安装默认模型。桌面与 CLI 补丁只把 pi-ai 的逻辑路由 `openai-codex` 加为可选模型提供方；它们不安装 Codex CLI、不挂载 Codex subagent，也不替换 Harness agent loop。

未配置 OpenAI 凭据时在 App 中选择 OpenAI GPT 模型，App 会自动暂停模型选择，并提供 ChatGPT 浏览器 OAuth、ChatGPT 设备码 OAuth，或 OpenAI Platform API key。浏览器与设备码登录使用符合条件的 ChatGPT 订阅权限；API-key 方式使用单独计费的 Platform 权限。App 菜单中的“OpenAI 登录或切换方式…”可主动打开同一个选择界面。“OpenAI 登录状态”会报告已存储的方式，“退出 OpenAI”会删除凭据。

OAuth token 与 API key 保存在 `~/Library/Application Support/DeepSeek Harness` 下仅限文件所有者读取的 JSON 文档中；OAuth 刷新通过跨进程文件锁串行化。API key 从密码输入框或 CLI 提示经标准输入传给 helper，绝不出现在其命令行参数中。认证成功后，被暂停的 `openai-codex` 模型选择会继续。Harness 的 loop、本地工具、提示词、会话与 agent 编排全部照旧，只切换所选 LLM 提供方。

## Pi OpenAI 行为

ChatGPT 浏览器与设备码登录使用 pi-ai 原生 `openai-codex-responses` 实现，并支持 OAuth 自动刷新。ChatGPT 的 Codex 后端要求 `store: false`，因此 pi-ai 会通过它支持的传输方式处理续接。API key 保持界面中相同的 `openai-codex` 路由与模型选择，但在内部经 pi-ai 的标准 OpenAI Responses 提供方分派；该路径启用服务端响应存储、持久化 `previous_response_id` 与 `reasoning.context: "all_turns"`。回放元数据会在这次内部分派中保留逻辑路由。

两条路径都使用 high 推理、长时 cache、自动传输选择、Harness session id、提供方回放元数据，以及 catalog 提供的推理档位；所选模型具备能力时包括 `xhigh` 与 `max`。

Harness 的本地 Shell、补丁编辑、Skills、MCP、工具搜索、程序化工具调用和多 Agent 编排仍由 Harness 自己提供，不会伪装成 OpenAI Hosted Shell 调用。这两个 profile 都刻意不安装、也不启用 Claude Code。

## 构建

在仓库根目录使用 Node.js 24 和 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

在 `--` 后传入 `--output <目录>` 可指定其他输出目录。构建器会从 [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json) 生成生产部署，把旧式 hoist 的 workspace 包补回部署目录，将包管理器链接实体化为可移动文件，然后编译原生启动器、生成图标、移除 AppleDouble 元数据、对 App 做 ad-hoc 签名和验证，并创建 App 与 CLI 两个 ZIP。
