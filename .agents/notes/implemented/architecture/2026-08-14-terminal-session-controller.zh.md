# Agent Note：终端会话控制器 — 采用、引导、取消与退出即 flush 的单一持有者

Status: implemented

[English](2026-08-14-terminal-session-controller.md) | 中文

## 问题

终端客户端此前有两条各自独立的 Agent 生命周期：`runOneShot` 与 `runInteractive` 各自创建、驱动、flush 并销毁自己的 Agent。于是最小闭环语义（跨轮次保持同一会话、运行中提交、第一次 Ctrl+C 只取消、退出即 flush）只能修两遍，且两处修复存在漂移风险。轮次运行中到达的提交会排成第二个普通轮次而不是引导（steer）；当所属轮次被取消时，审批可能永远挂起（挂起的提示从未被解除）；TUI 组合只挂载了 `userQuestions` 服务却没有 `ask_user_question` 工具，模型根本无法向人类提问。

## 决策

**一个 `TerminalSessionController` 为两个 surface 持有会话生命周期。** 它持有活跃的 `AgentHandle`，负责采用（`start`）与切换（`replace`）会话，让每次提交都经过同一条路径，并持有实时事件流与审批/提问应答器，全部在 `shutdown` 时解除。两个 runner 都以各自的 surface 回调构造它；一次性 runner 复用与 REPL 相同的 `submit`/`shutdown` 路径。

**由 `agent.status` 决定引导。** `submit` 在 Agent 报告 `running` 时引导（按 inbox 的引导语义在下一步边界处消费），否则发起后续轮次；运行指示器由控制器驱动，而不是调用点各自记账。`settle` 覆盖那些自行唤醒 Agent 的命令 surface。

**第一次 Ctrl+C 只取消当前轮次；Ctrl+D 或 `/quit`/`/exit` 退出并 flush。** 取消还会通过 `UiStore.dismissPrompt` 解除任何挂起的提示，使等待答案的审批/提问以“驳回”收场而不是挂死。`shutdown` 的顺序是：运行中则取消 → 停稳 → flush → 销毁 → 解除监听。

**提问是预设编号或键入文本；审批保持封闭。** 带选项的提问渲染为自由文本提示，其个位数快捷键只在缓冲区为空时生效；提交的一行被解析为范围内数字 token（选中预设）与剩余文本（`custom`），因此多选可两者兼得。无选项提问按多行文本收集，直到出现空行。审批仍是封闭的 y/n 选择，被驳回的审批解析为 `cancelled`，绝不会是 `allowed-once`。

**`dsh exec "<task>"` 是一次性模式的规范入口。** 启动器新增 `exec` 子命令，解析为 tui profile，其后的内容原样透传给应用（`--json`、`--jsonl`、`--resume`、`-m`、`-i`、`--ephemeral`）；裸 `dsh "<task>"` 保留为别名。由于 TUI 组合没有 agent 预设，`tool-ask-user` 条目直接挂载在该组合中。

## 后果

`TerminalSessionController` 以逐文件 100% 覆盖率交付。PTY e2e（CI 通道，真实 Loader 树）现在驱动五个场景：含中文输入的多轮对话并以持久化会话产物验证 Ctrl+D flush；对带预设的问题键入自定义答案（并在下一次模型请求中断言该答案）；y 批准的 bash 调用；Ctrl+C 只取消慢速轮次且会话仍可继续使用；普通 `/quit`。PTY 驱动器固定 `TIOCSWINSZ`，使新建 pty 能确定性地渲染 Ink 布局，而不是继承 0 行的 winsize。轮次运行中提交这一可观察行为发生变化：该行会在下一步边界引导进行中的轮次，而不是排队一个后续轮次。

## 备选方案

- **运行中提交时先取消再后续**：中止进行中的步骤并丢失其部分成果；在下一步边界引导可以保留它，并与 Agent inbox 既有语义一致。
- **仅保留裸位置参数作为一次性入口**：一次性与打错字的交互标志难以区分；显式 `exec` 与 Codex 对齐，同时保留位置参数作为兼容别名。
- **通过 agent 预设挂载提问工具**：TUI 组合没有预设系统，为单个工具条目引入整套预设比直接挂载 bundle 条目及其清单依赖更重。
