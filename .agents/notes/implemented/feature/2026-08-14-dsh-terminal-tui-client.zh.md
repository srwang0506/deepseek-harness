# Agent Note：dsh 成为 Codex 式终端客户端

Status: implemented

[English](2026-08-14-dsh-terminal-tui-client.md) | 中文

## 问题

`dsh` 启动器此前只是一个 profile 引导器：`--profile headless` 跑一个任务、`web` 启动浏览器 UI。没有交互式终端界面，因此主 CLI 无法像 Codex 式客户端那样工作——维持一个实时会话、流式输出、展示工具调用、行内回答审批、续跑更早的会话。裸 `dsh` 在没有 `--profile` 时也会直接拒绝运行。

## 决策

新增 `@deepseek-ai/dsh-tui` 组合包（位于 `packages/bundle/tui`，profile 为 `tui`），叠加在 `dsh-base` 之上，不挂载 Host、HTTP 或浏览器条目。它的 `tui-startup` 提供方拥有命令行（任务位置参数、`--resume`、`--continue`、`--model`、`--help`），发布 `tuiStartup` 服务；`tui-runner` 插件经惰性配置读取该服务。有任务时 runner 为一次性模式（创建/续跑一个 Agent、驱动到停稳、flush、打印最终文本、按 turn-end 原因退出）；没有任务时，它挂载全屏 Ink/React 应用（顶部状态栏、可滚动对话区、底部输入行），覆盖在可观察的 `UiStore` 上；Markdown、语法高亮与 diff 以 React 组件渲染。它把 `session/event` 增量推入该 store，注册 `approval/request` 应答器与 `userQuestions` 提供方行内提示（经提示队列串行化），并处理 `/new`、`/resume`、`/sessions`、`/model`、`/status`、`/compact`、`/init`、`/doctor`、`/export`、`/diff`、`/undo`、`/help`、`/quit`。未知命令分派到共享的 `ctx.commands` 注册表，因此 `/compact`、`/goal`、`/feedback`、`/permission`（均由 base 插件注册）可直接使用。续跑会话重放持久化转录；实时文本追加到单条 assistant 行；`/model` 修改实时 `ModelSelectionRef`，因此于下一步生效。多行粘贴作为一条命令处理；`@path` 引用解析为文件内容并支持 Tab 补全；Shift+Tab 循环切换权限预设，Ctrl+P 切换 plan 模式，Ctrl+C 取消当前轮；状态栏显示模型、权限预设与 plan 模式；补全弹层建议斜杠命令与 `@` 路径；`/diff` 与 `/undo` 查看并回退会话记录的文件差异。用户自定义的提示模板命令从 `$DSH_HOME/commands/*.md` 加载（名称 = 文件名、可选 `# heading` = 描述、正文 = 模板，含 `$ARGUMENTS` 占位符），并注册到同一命令注册表，因此终端像内置命令一样分派它们。

启动器现在让裸 `dsh`（无 `--profile`、无 `web`/`plugin` 子命令）默认引导 `tui` profile：`dsh` 启动交互会话、`dsh "task"` 为一次性、`dsh web` 保持不变。`--profile <name>` 仍可引导任意命名 profile；无 profile 的 `dsh --help` 保留启动器自身的帮助。

## 验证

`tui` 单元测试锁定渲染原语（theme、Markdown、highlight、diff、present）、事件分发器、斜杠命令解析与 raw-mode 输入读取器；`startup.spec.ts` 通过真实 Loader 引导提供方并断言解析出的调用、帮助与拒绝路径；`runner.spec.ts` 在真实注册表上驱动一次性完成与错误退出码映射。`apps/cli/tests/args.spec.ts` 锁定新的默认 profile 路由，source-launch 与 built-bin e2e 套件锁定非 TTY 的「未提供任务」诊断。

## 备选方案

**把 REPL 手写进启动器。** 这会绕过 bundle/profile 架构，并重复 `dsh-base` 已挂载的内容（agent、approval、questions、persistence）。组合包改为复用现有接缝。

**使用 TUI 框架（ink/React）。** 已采纳：要匹配 Codex 需要全屏 alternate-screen 界面，raw-mode 读取器加纯 ANSI 渲染模块无法提供。它把 React 引入 host 平面，并新增 ink 作为运行时依赖；纯 ANSI 渲染模块保留给一次性文本路径。

**把一次性模式留在 `headless` profile。** 将 `dsh "task"` 与裸 `dsh` 路由到不同 profile 会割裂终端客户端的一体性；把一次性模式并入 `tui` 让命令的各模式归于同一应用，而 `--profile headless` 继续供脚本使用。

## 后果

裸 `dsh` 现在是产品入口，行为类似 `codex`。`tui` 组合包共享 base 的 agent、tool、approval、question 与 persistence 接缝，因此其模型可见表面与其他模式保持一致。流式文本在实时模式下为原始输出（Markdown 仅应用于重放），`/model` 切换于下一步生效；两者均为已记录在案的暂缓工作，而非回退。
