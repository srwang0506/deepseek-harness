# Agent Note: OpenAI Responses 控制与可移动 macOS 打包

Status: implemented

[English](2026-08-14-openai-responses-codex-desktop.md) | 中文

## 问题

使用 OpenAI API key 的部署不能只修改模型名称：第一方 Responses 续接与推理控制拥有独立的持久历史和隐私语义。桌面交付也需要闭合的生产运行时，而不能暗中依赖源码 checkout。产品专用集成不应回到每个通用 `dsh` 安装中，账号 OAuth 凭据也不能被悄悄当作 OpenAI API key。

本记录最初涉及的桌面默认模型、账号 OAuth、可选 GPT 路由、委派姿态与图标部分，已由 [Pi OAuth GPT 桌面决策](2026-08-14-pi-oauth-gpt-desktop.md)取代。本记录继续负责通用 Responses 控制与可移动 macOS 打包闭包。

## 决策

对使用 `openai-responses` 的 profile，`openAIResponses.store` 开启服务端响应存储。`previousResponseId` 要求开启存储，并且只从提供方路由、模型、API 与响应 id 全部匹配的最近持久化 assistant 响应续接。请求发送 `previous_response_id` 和该响应之后的消息，系统提示仍单独提供。外部或不兼容历史会发送完整持久对话。`reasoningContext: all_turns` 增加 `reasoning.context`；推理档位、按 session 设置的 prompt cache、cache retention、传输、工具与 replay metadata 继续由各自组件拥有。这些字段不作用于 Chat Completions，也不作用于 pi-ai 的 ChatGPT OAuth 后端。

仓库还提供 Apple 芯片桌面构建路径。原生 AppKit 启动器内置 Node、构建后的 Harness Web 应用与生产依赖闭包；它在操作系统分配的端口上启动私有 loopback 服务，让实际进程 cwd 留在 APFS，同时把 `/Volumes/sirui/deepseek-harness` 设为首选逻辑工作区；部署状态与日志保存在用户 Library 中，退出时终止子服务，并产出经过 ad-hoc 签名的 `deepseek harness.app` 和适合存放在 exFAT 上的无元数据 ZIP。

`apps/desktop-runtime/package.json` 仍是仅用于部署的清单。它承载运行时闭包而不改变通用 `@deepseek-ai/dsh` 应用依赖图。构建器在签名前把包管理器链接实体化为文件，使 App 可移出 checkout。当前默认模型、OAuth 与图标行为由取代本记录的桌面 Note 定义。

## 验证

适配器测试固定第一方 payload 字段、同路由历史边界、cache metadata、非目标协议隔离，以及 `previousResponseId`/`store` 校验规则。运行时闭包验证覆盖桌面清单可达的全部 workspace 依赖。生产构建、原生编译、严格代码签名验证、property list 校验、零符号链接扫描与真实 loopback 启动共同覆盖打包产物。

## 考虑过的替代方案

**把产品集成恢复到通用生产应用。** 这会让每个 CLI 安装都下载可选产品代码，并推翻生产依赖边界。仅部署清单让发行成本保持局部。

**把账号 OAuth 当作 API-key 凭据。** 两者的认证契约、端点、刷新所有者与服务端存储能力不同。复用私有 token 文件会让 Harness 绑定另一个客户端的存储，而且可能在刷新行为变化后失效。

**为兼容性使用 Chat Completions。** 它无法携带所选第一方响应游标与推理上下文契约。适配器只对 `openai-responses` descriptor 应用这些控制。

**直接从 exFAT 运行 App。** AppleDouble 元数据可能使签名 bundle 失效。安装后的 App 留在 APFS，源码 checkout 与 ZIP 可以存放在 `/Volumes/sirui`。

## 后果

使用 API key 的 OpenAI 路由可以在明确隐私姿态下选择提供方侧响应存储与紧凑游标续接。桌面产物较大，因为它内置 Node、Web 资源与生产 Harness 闭包；相应地，它无需全局 Node 或 pnpm，也可独立于 checkout 移动。打包路径不决定默认模型，也不授权跨提供方契约复制凭据。
