# Agent Note: 带 Codex 委派的 OpenAI Responses 桌面发行版

Status: implemented

[English](2026-08-14-openai-responses-codex-desktop.md) | 中文

## 问题

以 OpenAI 为主的 macOS 部署不能只修改默认模型名称。主循环必须保留第一方 Responses 的续接与推理控制，可选的 Codex 账号路径必须使用官方登录和 app-server 生命周期，最终交付的应用也必须携带闭合的生产运行时，而不能依赖源码 checkout。若把产品集成重新加入每个 `dsh` 安装，会违背[生产依赖边界](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md)；若把 Codex OAuth 凭据当作通用 OpenAI API key，又会跨越官方客户端刻意分离的认证边界。

## 决策

仓库提供 Apple 芯片桌面构建路径。原生 AppKit 启动器内置 Node、构建后的 Harness Web 应用、生产依赖闭包、官方 Codex CLI 和以 OpenAI 为主的 Cordis 补丁。它在操作系统分配的端口上启动私有 loopback Web 服务，让实际进程 cwd 留在 APFS，同时把 `/Volumes/sirui/deepseek-harness` 统一配置为 host、文件系统和 sandbox 服务的首选逻辑工作区；部署状态和日志保存在用户 Library 中，App 退出时会终止子服务。最终打包为经过 ad-hoc 签名的 `deepseek harness.app`，以及适合存放在 exFAT 上的无元数据 ZIP。

`apps/desktop-runtime/package.json` 是仅用于部署的清单。它包含 Codex 提供方及其运行时闭包，但不改变通用 `@deepseek-ai/dsh` 应用的依赖图。启动时，App 会维护一条从桌面 DSH home 指向内置 Codex 提供方的 profile 本地符号链接，让普通 Profile 解析能够找到这项显式安装的集成。若该路径已经存在且不是符号链接，App 会保留用户状态，并以可归因错误终止启动，而不是替换它。这个部署专用 opt-in 是对通用生产排除决策的补充，并未取代它。

主 Agent 使用 pi-ai 的 OpenAI 路由，并要求 `OPENAI_API_KEY` 凭据引用。对于 `openai-responses` 模型，`openAIResponses.store` 开启服务端存储；`previousResponseId` 要求开启存储，而且只从提供方路由、模型、API 和响应 id 都匹配的最近一条持久化 assistant 响应续接。请求随后发送 `previous_response_id`，并且只发送该 assistant 响应之后的消息；系统提示仍单独提供。若出现外部或不兼容的 assistant 响应，则发送完整持久化历史。`reasoningContext: all_turns` 增加 `reasoning.context`；已有的推理档位、按 session 设置的 prompt cache、cache retention、传输、工具和 replay metadata 仍由各自现有组件维护。

Codex 是一个可选前台子代理，以 `subagent_codex` 暴露，并遵循既有的 [Codex 提供方契约](2026-08-04-claude-code-and-codex-subagent-backends.md)。App 菜单调用内置官方 CLI 完成登录和状态查询，提供方则与官方 Codex app-server 通信。Harness 不会为主 Responses 路由读取、复制、转换或刷新 OAuth token。本桌面运行时和补丁不包含 Claude Code。

App 图标在构建时由仓库中的 DeepSeek 官方 favicon 路径生成，使用官方蓝色和黑色圆角方形背景。构建器会在签名前把包管理器链接实体化为文件，使 App 移出 checkout 后仍可运行。

## 验证

适配器测试固定了第一方 payload 字段、同路由历史边界、cache metadata、非目标协议隔离，以及 `previousResponseId`/`store` 校验规则。运行时闭包校验器证明桌面清单可达的每个 workspace 依赖都已声明。生产构建、严格代码签名验证、property list 校验、零符号链接扫描、内置 CLI 烟测和真实 loopback Web 启动共同覆盖打包产物。

## 考虑过的替代方案

**把 Codex 和 Claude Code 恢复到通用生产应用。** 这会让每个 CLI 安装都下载可选产品代码，并推翻生产依赖决策。独立桌面清单只为本发行版承担该成本，而且只包含 Codex。

**把 Codex OAuth 登录作为主 OpenAI 模型凭据。** Codex 客户端拥有登录、刷新和 app-server 认证；Responses API key 路由拥有另一套契约。复用 token 文件会让 Harness 依赖私有凭据存储，并可能在 token 不再刷新时悄然失效，因此两条路径保持显式分离。

**让所有 GPT 请求都经过 Codex。** 这只会提供委派语义，无法让主 Harness 循环直接拥有模型选择、持久化历史、Responses 续接、prompt-cache key 和原生工具循环。Codex 保持为直接 OpenAI 适配器旁边可调用的专用子代理。

**为兼容性使用 Chat Completions。** 它无法携带本部署选定的第一方响应游标和 reasoning context 契约。适配器只在 catalog 模型解析为 `openai-responses` 时应用新控制，其他协议保持不变。

## 后果

桌面产物较大，因为它内置 Node、完整生产 Harness 闭包、Web 资源和 Codex 平台二进制；相应地，它不要求全局安装 Node 或 pnpm，并且可以独立于 checkout 移动。即使用户拥有 ChatGPT/Codex 订阅，主模型仍需要可计费的 OpenAI API 访问。启用游标续接后，服务端存储会成为已配置的 OpenAI 隐私姿态的一部分。Harness 的本地 Shell、补丁编辑、Skills、MCP、工具搜索、程序化工具调用和多 Agent 编排仍是 Harness 原生能力，而不是 OpenAI Hosted Shell 调用。
