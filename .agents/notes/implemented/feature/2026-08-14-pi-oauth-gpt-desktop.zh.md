# Agent Note: DeepSeek 优先桌面版中的 Pi OAuth GPT 模型

Status: implemented

[English](2026-08-14-pi-oauth-gpt-desktop.md) | 中文

## 问题

macOS 发行版应继续使用 DeepSeek Harness 作为 Agent 运行时、以 DeepSeek 作为默认模型，同时允许拥有符合条件 ChatGPT 订阅的用户选择 GPT 模型。把 Codex CLI 或 Codex app-server 当作子代理不满足这个要求：它会把工作移进第二套 Agent loop，而不是更换既有 Harness loop 背后的 LLM。把 Codex token 复制到 API-key 路由也会绕过提供方拥有的刷新与凭据语义。

本决策取代较早[OpenAI Responses 桌面决策](2026-08-14-openai-responses-codex-desktop.md)中有关桌面默认模型、OAuth、委派和图标的部分。旧记录继续负责通用 API-key Responses 控制与可移动桌面打包闭包。

## 决策

桌面组合保留 `deepseek-official/deepseek-v4-flash` 为默认模型，并把已安装 pi-ai catalog 的 `openai-codex` 提供方加入为可选路由。选择 `openai-codex/gpt-5.6-sol` 或其他 catalog GPT 模型时，只会更换既有 Harness 主循环选择的 LLM。提示词、持久会话、Shell 与补丁工具、Skills、MCP、工具搜索、程序化工具调用和 Agent 编排仍由 Harness 拥有。桌面运行时不再内置 Codex CLI，也不再挂载 Codex 子代理提供方。

`dsh-llm-pi-ai` 接受绝对路径形式的顶层 `credentialStorePath`，并把持久化 `CredentialStore` 注入每份不可变 pi-ai `Models` 快照。存储使用 pi-ai 规范凭据形状、仅所有者可访问的目录和文件权限、完整文档原子替换，以及共享的跨进程文件锁。因此 Pi 拥有提供方 OAuth 解析，并在存储的串行 `modify` 操作内执行 token 刷新。API-key 路由继续使用 Harness 凭据引用路径与按请求覆盖语义。

交互登录仍由组合拥有。AppKit 菜单运行一个小型内置 helper：注册 pi-ai 的 `openaiCodexProvider`，并调用 `Models.login('openai-codex', 'oauth', interaction)`；状态调用 `Models.getAuth()`，退出则调用 `Models.logout()`。helper 在用户浏览器中打开提供方授权 URL，并把结果凭据写进运行中 Harness 适配器使用的同一存储。它不读取或复用 Codex CLI 文件。

可选路由完整保留 pi-ai 的 `openai-codex-responses` 模型 descriptor 与提供方实现。桌面设置 high 推理、长时 cache 与自动传输选择。Pi 向后端提供 Harness session id 与提供方 replay metadata，并公开 catalog 的推理档位。ChatGPT Codex 后端使用 `store: false`；通用 API-key Responses 路由的 `store`、持久化 `previous_response_id` 与 `reasoning.context` 控制不会被强行套用到这里。

App 图标在构建时从仓库小鲸鱼路径生成，采用白色圆角底图与黑色小鲸鱼。App 名称仍是 `deepseek harness`。

## 验证

凭据存储测试覆盖存储不存在、API-key 与 OAuth 持久化、私有权限、并发写入、删除、回调失败及格式错误文档。配置测试要求仅支持 OAuth 的路由使用绝对存储路径，同时不破坏仍可用 API key 认证的提供方。既有适配器与 catalog 测试覆盖不可变快照、catalog 提供方复用、推理、回放与请求分派。桌面闭包、原生编译、App 签名、零符号链接打包和真实 loopback 启动共同覆盖交付产物。

## 考虑过的替代方案

**把 Codex 作为子代理内置。** 这会在一次委派调用后运行另一个产品的 loop 与工具，无法让 GPT 成为 DeepSeek Harness loop 使用的模型，因此已从桌面组合移除。

**把 GPT 设为桌面默认模型。** 所要求的产品姿态是 DeepSeek 优先、GPT 可选。覆盖 `agent-default-model` 会让未登录 OAuth 的首次使用失败，也会抹掉这一默认行为。

**复用 API key 或 Codex CLI 凭据文件。** API key 需要独立计费的 API 访问，而私有 Codex 文件会让 Harness 绑定另一个客户端的存储与刷新行为。Pi 提供方拥有的 OAuth 流程与规范凭据存储保留了目标 ChatGPT 认证契约。

**在桌面启动器中重新实现 OpenAI 协议。** Pi 已经拥有模型 catalog、OAuth、刷新、传输、响应回放与兼容行为。另一套客户端会分裂这些事实，并与 Harness 适配器使用的路由逐渐漂移。

## 后果

全新安装在进行任何 OpenAI 登录前即可使用 DeepSeek。用户完成 OAuth 后，GPT 会作为普通提供方／模型选项出现，全部 Harness 原生能力仍在同一个 loop 中。桌面现在拥有一份含机密的文件及浏览器登录交互，因此文件权限、原子写入、刷新加锁、退出和可归因登录错误都属于其安全边界。ChatGPT 后端行为以已安装 pi-ai 提供方所支持的内容为准；它与 API-key OpenAI Responses 路由并不完全相同，也不能被描述成服务端存储续接。
