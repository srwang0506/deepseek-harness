# deepseek harness macOS 版

[English](README.md) | 中文

本目录维护 Apple 芯片版桌面发行包。它用原生 AppKit 窗口承载官方 DeepSeek Harness Web 应用，内置 Node 运行时与生产依赖闭包，并在启动时应用 [`desktop.cordis.patch.yml`](desktop.cordis.patch.yml)。App 名称是 **deepseek harness**，图标使用白色圆角底图与 Harness 黑色小鲸鱼。

## 安装与启动

构建会生成 `deepseek harness.app` 和 `deepseek-harness-macos-arm64.zip`。请把 App 安装到 `/Applications` 后从 Finder 打开；ZIP 可以继续保存在 `/Volumes/sirui`。不要直接从 exFAT 卷运行解压后的 App，因为 macOS AppleDouble 文件可能让 bundle 签名失效。启动器会让后端进程的实际工作目录留在 APFS；若 `/Volumes/sirui/deepseek-harness` checkout 存在，则把它独立配置为 Harness 的逻辑工作区，否则两者都回退到当前用户的主目录。

发行包使用 ad-hoc 签名，没有经过 Apple 公证。若从 ZIP 解压后被系统隔离，首次启动请在 Finder 中按住 Control 点击 App，再选择“打开”。

App 把部署状态保存在 `~/Library/Application Support/DeepSeek Harness`，后端日志写入 `~/Library/Logs/DeepSeek Harness/backend.log`。可通过“deepseek harness → 显示后端日志”定位日志，通过“显示 → 重新载入”刷新 Web 界面。

## 默认 DeepSeek 与可选 OpenAI GPT

发行包保留官方 DeepSeek 路由，并继续以 `deepseek-official/deepseek-v4-flash` 作为主 agent 默认模型。桌面补丁只把 pi-ai 的逻辑路由 `openai-codex` 加为可选模型提供方；它不安装 Codex CLI、不挂载 Codex subagent，也不替换 Harness agent loop。

未配置 OpenAI 凭据时选择 OpenAI GPT 模型，App 会自动暂停模型选择，并提供三种方式：ChatGPT 浏览器 OAuth、ChatGPT 设备码 OAuth，或 OpenAI Platform API key。浏览器与设备码登录使用 ChatGPT 订阅权限；API-key 方式使用单独计费的 Platform 权限。App 菜单中的“OpenAI 登录或切换方式…”可主动打开同一个选择界面。“OpenAI 登录状态”会报告已存储的方式，“退出 OpenAI”会删除凭据。

OAuth token 与 API key 保存在 `~/Library/Application Support/DeepSeek Harness` 下仅限文件所有者读取的 JSON 文档中；OAuth 刷新通过跨进程文件锁串行化。API key 从密码输入框经标准输入传给原生 helper，绝不出现在其命令行参数中。认证成功后，被暂停的 `openai-codex` 模型选择会继续。Harness 的 loop、本地工具、提示词、会话与 agent 编排全部照旧，只切换所选 LLM 提供方。

## Pi OpenAI 行为

ChatGPT 浏览器与设备码登录使用 pi-ai 原生 `openai-codex-responses` 实现，并支持 OAuth 自动刷新。ChatGPT 的 Codex 后端要求 `store: false`，因此 pi-ai 会通过它支持的传输方式处理续接。API key 保持界面中相同的 `openai-codex` 路由与模型选择，但在内部经 pi-ai 的标准 OpenAI Responses 提供方分派；该路径启用服务端响应存储、持久化 `previous_response_id` 与 `reasoning.context: "all_turns"`。回放元数据会在这次内部分派中保留逻辑路由。

两条路径都使用 high 推理、长时 cache、自动传输选择、Harness session id、提供方回放元数据，以及 catalog 提供的推理档位；所选模型具备能力时包括 `xhigh` 与 `max`。

Harness 的本地 Shell、补丁编辑、Skills、MCP、工具搜索、程序化工具调用和多 Agent 编排仍由 Harness 自己提供，不会伪装成 OpenAI Hosted Shell 调用。这个桌面 profile 刻意不安装、也不启用 Claude Code。

## 构建

在仓库根目录使用 Node.js 24 和 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

在 `--` 后传入 `--output <目录>` 可指定其他输出目录。构建器会从 [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json) 生成生产部署，把旧式 hoist 的 workspace 包补回部署目录，将包管理器链接实体化为可移动文件，然后编译原生启动器、生成图标、对 App 做 ad-hoc 签名并创建 ZIP。
