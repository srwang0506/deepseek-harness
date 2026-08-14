# Agent Note: DeepSeek 优先原生发行版中的 Pi OAuth GPT 模型

Status: implemented

[English](2026-08-14-pi-oauth-gpt-desktop.md) | 中文

## 问题

原生发行版应继续使用 DeepSeek Harness 作为 agent 运行时、以 DeepSeek 作为默认模型，同时允许用户通过符合条件的 ChatGPT 订阅权限或 OpenAI Platform API key 选择 GPT。把 Codex CLI 或 Codex app-server 当作 subagent 不满足这个要求，因为它会把工作移进第二套 loop，而不是更换 Harness 使用的 LLM。交付物还需要统一的产品名称、可拖动的 macOS App、适合服务器的 Linux CLI，以及一条 GitHub 安装路径。

本决策取代较早[OpenAI Responses 桌面决策](2026-08-14-openai-responses-codex-desktop.md)中有关桌面默认模型、OAuth、委派、图标和产品命名的部分。旧记录继续负责通用 API-key Responses 控制与可移动生产依赖闭包。

## 决策

所有面向用户的发行版都叫 `DeepSeek Harness`，所有 CLI 都安装 `deepseek-harness`。macOS 构建生成 `DeepSeek Harness.app`、自包含 macOS CLI 及两个 ARM64 ZIP。共享发行构建器会部署生产 dsh 闭包，补回旧式 hoist 的 workspace 包，将包管理器链接实体化，复制宿主原生 Node.js 可执行文件，并拒绝任何残留符号链接。Linux 构建器复用同一闭包，生成原生 x64 与 ARM64 tar 归档。macOS 状态继续保存在 `~/Library/Application Support/DeepSeek Harness`；Linux 遵循 `${XDG_DATA_HOME:-~/.local/share}/deepseek-harness`；`DSH_HOME` 可覆盖两者。

macOS App 从仓库小鲸鱼路径生成白色圆角底图上的黑色小鲸鱼图标。普通 AppKit 标题栏负责原生窗口拖动。bundle 会先清除 AppleDouble，再完成签名和验证，然后归档。

组合保留 `deepseek-official/deepseek-v4-flash` 为默认模型，并把 pi-ai catalog 的 `openai-codex` 提供方加入为可选路由。选择 `openai-codex/gpt-5.6-sol` 或其他 catalog GPT 模型时，只会更换既有 Harness 主循环使用的 LLM。提示词、持久会话、Shell 与补丁工具、Skills、MCP、工具搜索、程序化工具调用和 Agent 编排仍由 Harness 拥有。运行时不内置 Codex CLI，也不挂载 Codex 子代理提供方。

`dsh-llm-pi-ai` 接受绝对路径形式的顶层 `credentialStorePath`，并把持久化 `CredentialStore` 注入不可变 pi-ai `Models` 快照。存储使用 pi-ai 规范凭据形状、仅所有者可访问的权限、完整文档原子替换，以及共享的跨进程文件锁。Pi 拥有提供方 OAuth 解析与 token 刷新。API key 保留 Harness 凭据引用路径与按请求覆盖语义；原生组合还可以在逻辑 `openai-codex` 路由下存储规范 API-key 凭据。

交互登录仍由组合拥有。App 会暂停尚未认证的 `openai-codex` `session.selectModel` 请求，并提供 ChatGPT 浏览器 OAuth、ChatGPT 设备码 OAuth，或 OpenAI Platform API key。打包后的 CLI 通过 `deepseek-harness login` 暴露同样选择。在无桌面的 Linux 服务器上，即使没有 GUI 或剪贴板工具，设备登录也始终打印设备码和验证网址。API key 经标准输入读取，绝不会出现在 helper 命令行参数中。

ChatGPT OAuth 保留 pi-ai 的 `openai-codex-responses` 实现与 `store: false` 传输语义。同一逻辑路由存储 API key 时，适配器会经 pi-ai 的标准 `openai` Responses 提供方分派，启用服务端响应存储、持久化 `previous_response_id` 与 `reasoning.context: "all_turns"`，再把回放元数据记录在原始路由与模型下。两种路径都保留 high 推理、长时 cache、自动传输选择、Harness session id 与 catalog 支持的推理档位。

POSIX 安装器要求显式选择 `macos-app`、`macos-cli`、`linux-x64` 或 `linux-arm64`。桌面 App 与 CLI 独立安装；场景与宿主操作系统或架构不符时，会在下载归档前失败。每条路径只下载自己需要的 GitHub Release 文件，按 `SHA256SUMS` 校验，并备份已有安装和旧错误命名安装。CLI 路径会创建稳定的 `~/.local/bin/deepseek-harness` 链接。tag 触发的 workflow 在 GitHub 原生 runner 上构建全部平台，并发布四个归档、安装器和校验清单。服务器 Web 界面在文档中只监听 loopback，远程访问使用 SSH 隧道。

## 验证

凭据存储测试覆盖 API-key 与 OAuth 持久化、私有权限、并发写入、删除、回调失败及格式错误文档。适配器测试固定已存密钥分派到 `/v1/responses`、Responses 控制与逻辑回放身份。界面测试固定分派前的三选一登录，并要求模型选择保持暂停直到认证成功。发行测试固定准确的产品与文件名称、标题栏行为、支持的 GitHub runner、Linux 状态路径、无桌面 OAuth 输出、必须选择场景、宿主不匹配拒绝、仅 App 安装，以及针对本地夹具归档完成的真实 CLI 校验和安装。macOS 验证还覆盖原生编译、签名、AppleDouble 清理、零符号链接打包、归档 smoke 与真实 loopback 启动。GitHub Release job 会在原生架构上 smoke Linux 产物。

## 考虑过的替代方案

**把 Codex 作为子代理内置。** 这会在一次委派调用后运行另一个产品的 loop，无法让 GPT 成为 DeepSeek Harness loop 使用的模型。

**把 GPT 设为发行版默认模型。** 所要求的产品姿态是 DeepSeek 优先。缺少 OpenAI 登录不能破坏首次使用。

**强制 API key 或复用 Codex CLI 凭据。** 强制密钥会排除 ChatGPT 订阅权限；复用另一个客户端的私有凭据文件会耦合存储与刷新行为。Pi 提供方拥有的 OAuth 流程让这些关注点保持独立。

**通过 ChatGPT Codex 传输发送 API key。** 该提供方以订阅后端为目标，并声明 OAuth 认证。标准 OpenAI 提供方才是 Platform key 对应的公共 Responses API 路径。

**从 macOS 交叉编译 Linux。** 归档包含宿主原生 Node.js 可执行文件与原生依赖闭包，因此由原生 Linux x64 和 ARM64 runner 构建更可靠。

**只发布源码或 npm 全局安装器。** 这些方式要求服务器准备工具链，并暴露包管理器布局差异。发行归档自包含且会校验哈希。

**让 Web UI 公开监听。** 内置界面不提供公网边缘认证。loopback 加 SSH 隧道可以让远程使用保持在既有安全边界内。

## 后果

全新安装在进行任何 OpenAI 登录前即可使用 DeepSeek。选择 GPT 会显示三种认证方式，全部 Harness 原生能力留在同一个 loop 中。ChatGPT 与 API-key 请求有意使用不同传输和计费关系，同时模型选择器保留一条逻辑路由。macOS App 用户、macOS 终端用户、Linux x64 服务器和 Linux ARM64 服务器共用一个发行安装器，但会选择不同场景参数；任何场景都不会安装无关界面。运行时归档仍采用原生构建。替换前会备份已有目标，而不是合并目录，因此已签名 bundle 与自包含运行时可以原子替换并保留恢复路径。
