# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

dsh 终端界面组合包：叠加在 [`dsh-base`](../base/README.md) 之上的 Codex 式全屏终端客户端（Ink/React）。[`cordis.patch.yml`](cordis.patch.yml) 提供编码 persona 与工具模式、禁用 HMR，并插入本包的 `tui-startup` 提供方与 `tui-runner` 插件。它不挂载任何 Host、HTTP server、Web runtime 或浏览器插件。

普通 `tui-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），解析本应用的命令行：一次性任务位置参数、`--resume <id>`、`--continue`、`--model <model>` 与 `--help`。runner 注入该服务，再从惰性配置中读取本次调用。

runner（[`src/index.ts`](src/index.ts)）有两种模式。当 `task` 非空时，它通过 `ctx.agents` 驱动一个全新或续跑的 Agent，等待停稳、flush Session、打印最后一条非空 assistant 文本，最终轮次完成则退出码 0，否则 1。没有任务时，它挂载一个全屏 Ink 应用（[`src/ui/app.tsx`](src/ui/app.tsx)），运行在可观察 store（[`src/ui/store.ts`](src/ui/store.ts)）之上：把会话事件流式打印到终端（assistant 文本、reasoning、工具调用与带 diff 着色的结果），通过注册 `approval/request` 应答器与 `userQuestions` 提供方来行内回答审批/提问，行内应答审批（Shift+Tab 循环权限预设，Ctrl+P 切换 plan mode），用 Tab 补全把 `@path` 提及解析为文件内容，用 ↑↓ 调出提交过的输入历史，从 `$DSH_HOME/commands/*.md` 加载用户定义的提示词模板命令，并处理 `/new`、`/resume [id]`、`/sessions`、`/model [model]`、`/login [method]`、`/logout`、`/status`、`/compact`、`/init`、`/doctor`、`/export`、`/diff`、`/undo`、`/help`、`/quit` 这些斜杠命令；`/login` 会挂起 Ink 界面，在原始终端上运行浏览器/设备码/API key 三种 OpenAI GPT 登录流程。续跑的会话会在提示符前以带样式的 Markdown 重放其持久化转录。

渲染是一组纯函数、零依赖模块：[`src/theme.ts`](src/theme.ts)（ANSI）、[`src/markdown.ts`](src/markdown.ts)、[`src/highlight.ts`](src/highlight.ts)、[`src/diff.ts`](src/diff.ts) 与 [`src/render.ts`](src/render.ts)（事件分发）。

## 模型体验

本组合包不新增任何内容：提示词与工具由 base 条目提供。persona 与其他 surface 保持一致，重述同一句编码代理描述。

#### KV Cache 影响

无；runner 不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **流式文本为原始输出**：实时 chunk 增量不经过格式化；Markdown 样式仅应用于续跑会话的重放转录。
- **`/model` 于下一步生效**：可变模型选择在每一步的提示词组装时读取，因此切换落在后续轮次，而非正在进行的请求。
- **`ctx.appExit` 由启动器持有**：在 `dsh` 启动器之外启动 tui profile 会在激活时明确报错，直到宿主提供该退出请求。
