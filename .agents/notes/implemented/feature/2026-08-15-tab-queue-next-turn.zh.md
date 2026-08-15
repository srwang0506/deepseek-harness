# Agent Note：Tab 排队下一轮 —— steering 的姊妹路径，在 controller 处分离

Status: implemented

[English](2026-08-15-tab-queue-next-turn.md) | 中文

## 问题

Codex 的 composer 有两条运行中提交路径：Enter 注入当前轮次（steering），Tab 把该行排到当前轮次结束之后的下一轮。DSH 只有前者——运行中提交的行总是 steering——用户无法在 Agent 工作期间预先准备下一条提示。

## 决策

**队列状态放在 controller，单槽位。** `TerminalSessionController.queue(message)` 存储消息并链接 `agent.whenIdle()`：Agent 运行期间，槽位持有消息，`onQueueChange(true)` 点亮 `⇥ queued` 状态标记；当前轮次停稳后，排空逻辑把它作为普通 followup 提交并清除标记。新排队替换旧排队；空闲时排队立即提交；销毁时清空槽位与标记。

**Tab 是 App 侧触发器。** `applyComposerKey` 把 Tab（标志位、PTY 以输入文本送达的孤立 `\t` 字节、或与键入 chunk 合并的 tab）解析为补全意图；App 在 store 报告运行中且行非空时把它路由到 `onQueue`，否则走路径补全。runner 立即把排队行作为用户行渲染——该行已经是会话的一部分。

## 后果

controller 的队列路径单元覆盖率 100%（运行中排队+排空、替换、空闲即发、销毁清空、无 Agent 丢弃）；App 分支与 `⇥ queued` 标记渲染由 ui-render 覆盖。运行中 Tab 没有 PTY 场景：PTY 驱动的键入会合并为带内嵌 tab 的单一读 chunk，mock 的 8 字符 SSE chunk 使任何流要么短于回显等待协议、要么长达数分钟，而上述分层测试已确定性地覆盖语义。帮助文本与 README 记录 Tab 排队；Known Limitations 将其移出暂缓的 composer 事项。

## 备选方案

- **队列列表而非单槽位**——Codex 只排队一个下一轮；列表会带来产品尚不存在的排序问题，单槽位使排空逻辑天然无竞态。
- **队列放在 App 状态**——队列必须跨越 controller 拥有的轮次边界；App 本地状态需要自己的空闲观测，且无法在销毁时 flush。
