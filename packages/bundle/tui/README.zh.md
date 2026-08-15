# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

dsh 终端界面组合包：叠加在 [`dsh-base`](../base/README.md) 之上的 Codex 式全屏终端客户端（Ink/React）。[`cordis.patch.yml`](cordis.patch.yml) 提供编码 persona 与工具模式、禁用 HMR，并插入本包的 `tui-startup` 提供方、`tui-runner` 插件与面向模型的 `tool-ask-user` 条目（TUI 组合没有 agent 预设，因此提问工具直接挂载在这里）。它不挂载任何 Host、HTTP server、Web runtime 或浏览器插件。

普通 `tui-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），解析本应用的命令行：一次性任务位置参数（规范形式为 `dsh exec "<task>"`，裸 `dsh "<task>"` 保留为别名；裸 `dsh exec` 从管道 stdin 读取任务）、`--resume <id>`、`--continue`、`--model <model>`、`--json`、`--jsonl`（版本化流：一条 `init` 信封、每个事件一条带 `v` 的行、一条 `result` 行）、`--output-schema <schema>`（内联 JSON 或文件路径；最终输出不匹配时以 2 退出）、`-o/--output-file <path>`、`-i/--image <path>`、`--ephemeral` 与 `--help`。runner 注入该服务，再从惰性配置中读取本次调用。

runner（[`src/index.ts`](src/index.ts)）有两种模式，共享同一个 `TerminalSessionController`（[`src/controller.ts`](src/controller.ts)）：它持有 Agent 的采用与销毁、实时事件流以及审批/提问应答器——轮次运行中提交的输入会在下一步边界处引导（steer）Agent，`shutdown()` 则取消正在运行的轮次、flush、销毁并解除监听。当 `task` 非空时，它通过 `ctx.agents` 驱动一个全新或续跑的 Agent，等待停稳、flush Session、打印最后一条非空 assistant 文本，最终轮次完成则退出码 0，否则 1。没有任务时，它挂载一个全屏 Ink 应用（[`src/ui/app.tsx`](src/ui/app.tsx)），运行在可观察 store（[`src/ui/store.ts`](src/ui/store.ts)）之上：把会话事件流式打印到终端（assistant 文本、reasoning 与带 diff 着色的结果；用户行与工具活动以暗色 `⏺` 标记行呈现，Codex 式，工具名标注每个调用行、其结果行即卡片正文），以封闭的 y/n 选项行内应答审批（Esc、Ctrl+D 或轮次取消会把该请求按 cancelled 驳回），以预设编号、键入的自定义答案或多行自由文本行内回答提问（多选同时支持勾选预设与附加文本），用 Tab 补全把 `@path` 提及解析为文件内容，用 ↑↓ 调出提交过的输入历史，用 `!` 前缀执行本地 shell 命令，从 `$DSH_HOME/commands/*.md` 加载用户定义的提示词模板命令，用提示中的 `$name` token 调用技能（技能的渲染指令以 `skill-invocation` 消息注入，与模型自行调用 `skill` 工具的路径一致），并处理 `/new`、`/fork`、`/delete [id]`、`/resume [id]`、`/sessions`、`/model [model]`、`/reasoning [effort]`（off/high/max；`default` 清除）、`/login [method]`、`/logout`、`/status`、`/permissions [preset]`、`/compact`、`/init`、`/doctor`、`/export`、`/diff`、`/review`、`/undo`、`/help`、`/quit`、`/exit` 这些斜杠命令；不带参数的 `/resume`（以及启动器的 `dsh resume`）会打开会话选择器，列出带折叠标题的持久化会话——方向键移动高亮，Enter 续跑，`f` 分叉选中项（持久化会话经由 agents 注册表加载、分叉并销毁源会话），Esc 取消——而 `dsh resume --last` 续跑最近的会话；`/status` 报告完整会话状态——身份、模型与推理强度、带工作区根的 sandbox 模式、审批策略、权限预设与实时 token 用量——`/permissions [preset]` 则显示或切换会话的权限预设（持久化会话事件，续跑时恢复）；第一次 Ctrl+C 只取消当前轮次，而 Ctrl+D（与 `/quit`、`/exit` 一样）退出并 flush。模型选择是会话级的：续跑会话会从其折叠的 `request/context` 事件恢复路由、从最后一条请求头恢复推理强度，底部状态栏（普通 composer 行下方的暗色 Codex 式一行）左侧为会话事实——生效中的 sandbox 模式、实时 token 用量与权限预设——右侧为带强度的模型（`-m` 启动覆盖会加标），轮次运行中显示 braille spinner；父链到达当前根会话的 subagent 会话会以带标签的后台行渲染（工具调用、最终消息、失败）。；`/login` 会挂起 Ink 界面，在原始终端上运行浏览器/设备码/API key 三种 OpenAI GPT 登录流程。续跑的会话会在提示符前以带样式的 Markdown 重放其持久化转录。

渲染是一组纯函数、零依赖模块：[`src/theme.ts`](src/theme.ts)（ANSI）、[`src/markdown.ts`](src/markdown.ts)、[`src/highlight.ts`](src/highlight.ts)、[`src/diff.ts`](src/diff.ts) 与 [`src/render.ts`](src/render.ts)（事件分发）。

## 模型体验

### Persona

#### 模型所见

每次请求都带有一句系统提示词：一句指明当前模型与工作目录的编码代理描述。与其他 surface 使用同一句描述，`{{model}}` 与 `{{cwd}}` 按会话模板化。

#### Token 影响

组合包激活期间，每次请求有少量固定输入开销。

#### KV Cache 影响

在模型与工作目录不变的会话内前缀稳定；切换模型会重新渲染该句。

### 工具：ask_user_question

#### 模型所见

模型看到生成的 [`ask_user_question` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ask-user)。由于 TUI 组合没有 agent 预设，本组合包自行挂载该条目；终端通过 tui-runner 注册的提供方回答它。schema 携带具有稳定 id 的问题、问题行、可选的 header/detail、可选的预设选项与多选标志。

#### Token 影响

工具可见的每次请求都有固定 schema 开销。

#### KV Cache 影响

除条目在目录中的稳定位置外无其他影响；该工具不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **流式文本为原始输出**：实时 chunk 增量不经过格式化；Markdown 样式仅应用于续跑会话的重放转录。
- **`/model` 于下一步生效**：可变模型选择在每一步的提示词组装时读取，因此切换落在后续轮次，而非正在进行的请求。
- **`ctx.appExit` 由启动器持有**：在 `dsh` 启动器之外启动 tui profile 会在激活时明确报错，直到宿主提供该退出请求。
- **`/review` 行内评审**：评审提示以普通轮次运行于本会话收集的 diff 之上；把它委托给可续接 subagent 缝隙（使评审不污染主会话）的升级留待该缝隙暴露终端友好的一次性委托形式。
- **composer 仍是行编辑器，而非 Codex 的 composer 编辑器**：模糊文件搜索、`Ctrl+R` 历史搜索、Vim 模式、用 Tab 排队下一轮、回到上一条用户消息修改并分叉，均留待后续；当前编辑面为 ↑↓ 历史调出与 `@path` Tab 补全。
- **权限分类只有 ask/never**：Codex 式 `untrusted` 命令信任分类（自动放行低风险只读命令）、多个额外可写目录与 Hook 信任记录均留待后续；审批提示的允许只针对单次操作，`/permissions` 切换才是持久化的会话策略。
- **`/status` 不列出实际生效的指令文件**：agent-instructions 插件把 `AGENTS.md`/`CLAUDE.md` 折叠进会话日志，但没有注册表可供枚举；显示哪些文件实际生效留待后续。
