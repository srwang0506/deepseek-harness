# deepseek harness macOS 版

[English](README.md) | 中文

本目录维护 Apple 芯片版桌面发行包。它用原生 AppKit 窗口承载官方 DeepSeek Harness Web 应用，内置 Node 运行时与生产依赖闭包，并在启动时应用 [`openai.cordis.patch.yml`](openai.cordis.patch.yml)。App 名称是 **deepseek harness**，图标由仓库中的 DeepSeek 官方蓝色小鲸鱼与黑色圆角底图生成。

## 安装与启动

构建会生成 `deepseek harness.app` 和 `deepseek-harness-macos-arm64.zip`。把 App 复制到 `/Volumes/sirui` 或 `/Applications`，再从 Finder 打开。若 `/Volumes/sirui` 已挂载，启动器会把它作为工作区；否则回退到当前用户的主目录。

发行包使用 ad-hoc 签名，没有经过 Apple 公证。若从 ZIP 解压后被系统隔离，首次启动请在 Finder 中按住 Control 点击 App，再选择“打开”。

App 把部署状态保存在 `~/Library/Application Support/DeepSeek Harness`，后端日志写入 `~/Library/Logs/DeepSeek Harness/backend.log`。可通过“deepseek harness → 显示后端日志”定位日志，通过“显示 → 重新载入”刷新 Web 界面。

## OpenAI 与 Codex 认证

主 Agent 路由是使用 `openai/gpt-5.6-sol` 的 OpenAI Responses。它需要从启动环境中的 `OPENAI_API_KEY` 获取 OpenAI API 凭据，或由 Harness 凭据界面保存同名引用。

App 另外内置官方 `@openai/codex` CLI，并挂载 Harness 的 `codex` 子代理提供方。选择“deepseek harness → Codex 账号登录…”即可运行官方 ChatGPT/Codex OAuth 流程；“Codex 登录状态”用于查看状态。登录后，模型可以通过 `subagent_codex` 工具委派任务，Codex 会经官方 app-server 协议运行。

两条凭据链刻意保持分离：ChatGPT/Codex 账号登录只授权 Codex，不会被复制或改作主 Responses 模型的 API key。

## 原生 Responses 行为

桌面补丁开启了服务端响应存储、同路由 `previous_response_id` 续接、`reasoning.context: all_turns`、`reasoning.effort: high`、SSE 传输、长时 prompt cache，以及把 Harness session id 用作 prompt-cache key。若所选模型提供 `xhigh` 和 `max` 推理档位，底层模型 catalog 仍会将它们公开给选择器。

Harness 的本地 Shell、补丁编辑、Skills、MCP、工具搜索、程序化工具调用和多 Agent 编排仍由 Harness 自己提供，不会伪装成 OpenAI Hosted Shell 调用。这个桌面 profile 刻意不安装、也不启用 Claude Code。

## 构建

在仓库根目录使用 Node.js 24 和 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm run desktop:build
```

在 `--` 后传入 `--output <目录>` 可指定其他输出目录。构建器会从 [`apps/desktop-runtime/package.json`](../apps/desktop-runtime/package.json) 生成生产部署，把旧式 hoist 的 workspace 包补回部署目录，将包管理器链接实体化为可移动文件，然后编译原生启动器、生成图标、对 App 做 ad-hoc 签名并创建 ZIP。
