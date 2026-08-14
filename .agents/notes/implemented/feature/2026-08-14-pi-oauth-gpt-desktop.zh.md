# Agent Note: DeepSeek 优先桌面版中的 Pi OAuth GPT 模型

Status: implemented

[English](2026-08-14-pi-oauth-gpt-desktop.md) | 中文

## 问题

macOS 发行版应继续使用 DeepSeek Harness 作为 agent 运行时、以 DeepSeek 作为默认模型，同时允许用户通过符合条件的 ChatGPT 订阅权限或 OpenAI Platform API key 选择 GPT 模型。把 Codex CLI 或 Codex app-server 当作 subagent 不满足这个要求：它会把工作移进第二套 agent loop，而不是更换既有 Harness loop 背后的 LLM。把 Codex token 复制到 API-key 路由也会绕过提供方拥有的刷新与凭据语义，而只呈现 API-key 输入框又会排除订阅登录。

本决策取代较早[OpenAI Responses 桌面决策](2026-08-14-openai-responses-codex-desktop.md)中有关桌面默认模型、OAuth、委派和图标的部分。旧记录继续负责通用 API-key Responses 控制与可移动桌面打包闭包。

## 决策

桌面组合保留 `deepseek-official/deepseek-v4-flash` 为默认模型，并把已安装 pi-ai catalog 的 `openai-codex` 提供方加入为可选路由。选择 `openai-codex/gpt-5.6-sol` 或其他 catalog GPT 模型时，只会更换既有 Harness 主循环选择的 LLM。提示词、持久会话、Shell 与补丁工具、Skills、MCP、工具搜索、程序化工具调用和 Agent 编排仍由 Harness 拥有。桌面运行时不再内置 Codex CLI，也不再挂载 Codex 子代理提供方。

`dsh-llm-pi-ai` 接受绝对路径形式的顶层 `credentialStorePath`，并把持久化 `CredentialStore` 注入每份不可变 pi-ai `Models` 快照。存储使用 pi-ai 规范凭据形状、仅所有者可访问的目录和文件权限、完整文档原子替换，以及共享的跨进程文件锁。因此 Pi 拥有提供方 OAuth 解析，并在存储的串行 `modify` 操作内执行 token 刷新。普通 API-key 路由继续使用 Harness 凭据引用路径与按请求覆盖语义；桌面 App 还可以在逻辑 `openai-codex` 路由下存储规范 API-key 凭据。

交互登录仍由组合拥有。AppKit `WKWebView` 中的文档起始脚本会拦截尚未认证的 `openai-codex` `session.selectModel` 请求，暂停请求，并提供 ChatGPT 浏览器 OAuth、ChatGPT 设备码 OAuth 或 OpenAI Platform API key。App 菜单打开同一个选择界面。小型内置 helper 会为两种 OAuth 方式调用 `Models.login('openai-codex', 'oauth', interaction)`，或校验并存储经标准输入读取的 API key；状态会报告已存方式，退出则调用 `Models.logout()`。它不读取或复用 Codex CLI 文件，密钥也绝不出现在 helper 的命令行参数中。

ChatGPT OAuth 完整保留 pi-ai 的 `openai-codex-responses` 模型 descriptor 与提供方实现。ChatGPT Codex 后端使用 `store: false`，通用 API-key Responses 路由的控制不会被强行套用到这里。同一逻辑路由存储 API key 时，适配器会把所选模型重新绑定到 pi-ai 的标准 `openai` Responses 提供方进行分派，启用 `store`、持久化 `previous_response_id` 与 `reasoning.context: "all_turns"`，再把回放元数据记录在原始路由与模型下。两种认证路径都保留 high 推理、长时 cache、自动传输选择、Harness session id 与 catalog 的推理档位。

App 图标在构建时从仓库小鲸鱼路径生成，采用白色圆角底图与黑色小鲸鱼。App 名称仍是 `deepseek harness`。

## 验证

凭据存储测试覆盖存储不存在、API-key 与 OAuth 持久化、私有权限、并发写入、删除、回调失败及格式错误文档。配置测试要求仅支持 OAuth 的路由使用绝对存储路径，同时不破坏仍可用 API key 认证的提供方。适配器测试固定已存密钥分派到 `/v1/responses`、第一方 Responses 控制与逻辑回放身份。jsdom 测试固定分派前的三选一界面，并验证模型选择会保持暂停，直到认证成功。桌面闭包、原生编译、App 签名、零符号链接打包和真实 loopback 启动共同覆盖交付产物。

## 考虑过的替代方案

**把 Codex 作为子代理内置。** 这会在一次委派调用后运行另一个产品的 loop 与工具，无法让 GPT 成为 DeepSeek Harness loop 使用的模型，因此已从桌面组合移除。

**把 GPT 设为桌面默认模型。** 所要求的产品姿态是 DeepSeek 优先、GPT 可选。覆盖 `agent-default-model` 会让未登录 OAuth 的首次使用失败，也会抹掉这一默认行为。

**强制使用 API key。** API key 是有效的显式选择，但若强制使用它，就会排除 ChatGPT 订阅权限，并复现本决策要修正的误导性 API-key-only 登录界面。

**复用 Codex CLI 凭据文件。** 私有 Codex 文件会让 Harness 绑定另一个客户端的存储与刷新行为。Pi 提供方拥有的 OAuth 流程与桌面 App 的规范凭据存储让两个产品保持独立。

**通过 ChatGPT Codex 传输发送 API key。** `openai-codex` 提供方以订阅后端为目标，并声明 OAuth 认证。经 pi-ai 的标准 `openai` 提供方分派已存密钥，可以保留界面中的 Harness 逻辑路由，同时使用正确的公共 Responses API。

**在桌面启动器中重新实现 OpenAI 协议。** Pi 已经拥有模型 catalog、OAuth、刷新、传输、响应回放与兼容行为。另一套客户端会分裂这些事实，并与 Harness 适配器使用的路由逐渐漂移。

## 后果

全新安装在进行任何 OpenAI 登录前即可使用 DeepSeek。选择 GPT 会自动显示三种认证方式；其中一种成功后，GPT 仍作为普通提供方／模型选项出现，全部 Harness 原生能力留在同一个 loop 中。桌面拥有一份含机密的文件、浏览器与设备码登录交互，以及 API-key 输入，因此文件权限、经标准输入传送密钥、原子写入、刷新加锁、退出和可归因登录错误都属于其安全边界。ChatGPT 与 API-key 请求有意使用不同传输和计费关系，即使模型选择器保持一条逻辑路由。
