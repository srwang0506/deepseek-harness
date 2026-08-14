# Agent Note：dsh 成为唯一的原生 CLI

Status: implemented

[English](2026-08-14-dsh-single-native-cli.md) | 中文

## 问题

原生发行版此前多发布了一个命令 `deepseek-harness`——一个套在 `dsh --profile headless` 之上的一次性包装层。它重复了启动器的工作，还独占着唯一的 OpenAI GPT 界面（`login`、`model`、`status`、`logout`），因此这些命令位于 `dsh` 之外，安装出来的命令也不是产品真正的终端客户端。而且只支持 macOS 与 Linux，Windows 没有 CLI 发行版。

## 决策

现在 `dsh` 是各平台唯一安装的命令。删除了 `deepseek-harness` 包装层（`apps/desktop-runtime/cli-entry.mjs`）与 `desktop/cli.cordis.patch.yml`；发行版启动器直接执行 `@deepseek-ai/dsh/lib/bin.js` 并设置 `DSH_HOME`，因此裸 `dsh` 会打开全屏 Ink 客户端。OpenAI GPT 的 `login`/`model`/`status`/`logout` 命令移入 `dsh`（`apps/cli/src/openai.ts` 与 `src/model.ts`），把凭据写入 `$DSH_HOME/pi-ai-auth.json`、默认模型写入 `$DSH_HOME/settings.yaml`——与 `llm-pi-ai` 提供方路由读取的是同一份文档。GPT 提供方配置从各 surface 专属 patch 中移出，放进共享的 home 级 `desktop/cordis.patch.yml`，由安装器写入 `$DSH_HOME/cordis.patch.yml`，使每个 profile（tui、web、headless）都会应用它。Windows CLI 发行版加入 macOS 与 Linux 行列：`scripts/build-windows-cli.ts`、一个 `.cmd` 启动器、`scripts/install-release.ps1`，以及 release workflow 中的 `windows-x64` 矩阵项。

## 验证

`apps/cli/tests/args.spec.ts` 固定了新子命令路由；`apps/cli/tests/model.spec.ts` 固定了模型选择写入 settings 文档并保留无关键；`scripts/native-distributions.spec.ts` 固定了 `dsh` 启动器名、home patch 安装与校验和的安装器。宿主与客户端类型检查、staged lint 均通过；Windows 的构建/启动器/安装器行为仅在 CI 中验证（沙箱内没有 Windows 主机）。

## 考虑的替代方案

**保留包装层，仅重命名为 `dsh`。** 这样 login/model 逻辑会留在已发布的 `@deepseek-ai/dsh` 包之外，`npx @deepseek-ai/dsh login` 就无法工作；把命令移入 `dsh` 能让 npm 与原生 surface 保持一致。

**在启动器里保留 `--patch`。** `dsh web` 会拒绝父级 `--patch`，因此启动器必须重新实现启动器的子命令路由；home 级 patch 会统一应用到每个 profile，无需这类路由。

## 后果

安装后的命令在 macOS、Linux、Windows 上都是 `dsh`，与 npm 包一致。App 仍以 `dsh web --patch desktop.cordis.patch.yml` 启动，现在它也会继承 home patch；该 patch 中的 `llm-pi-ai` 配置与 home patch 重复但内容一致。`desktop/openai-oauth.mjs` 仍服务于 App 的原生认证桥，而 CLI 使用 TypeScript 移植版，因此在 App 桥接层被合并前，OAuth 流程会以两处实现并存。
