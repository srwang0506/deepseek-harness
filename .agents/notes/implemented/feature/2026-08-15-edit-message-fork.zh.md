# Agent Note：编辑历史用户消息并从其轮次分叉会话

Status: implemented

[English](2026-08-15-edit-message-fork.md) | 中文

## 问题

Codex 允许用户回到任意一条历史用户消息、修改后从那里重新运行会话——经典的改写分叉交互。DSH 的 composer 没有这条路径，而且分叉机制存在一个潜在 bug：所有分叉采纳路径（`/fork`、选择器的 `f` 以及本次新加的编辑流程）都经由 `ctx.sessions.fork`，它产生的是 LIVE 子会话，而任何 Agent 采纳路径都无法接管（Agent 创建与续跑都经由持久化的 `prepare` 检查拒绝 live 会话），因此 live 会话上的 `/fork` 从未真正端到端可用。

## 决策

**分叉走持久化后端，绝不走 live store。** `forkSessionById` 现在快照源会话的事件前缀（以闭区间 seq 为界），并用 `sessionPersistence.create(meta)` + `append(id, seed)` 把子会话写入分离会话写路径。子会话从不 live，因此 `controller.replace(childId)` 像任何持久化会话一样通过普通持久化路径续跑。空 seed 大声报错：空子会话永远不会物化出产物。

**空 composer 上按 ↑ 打开编辑浮层。** 浮层按新到旧列出会话的 `user/message` 事件（source 为 user）；Enter 把一条载入 composer 并记录其分叉边界——该消息所属 `turn/start` 的前一个事件 seq——因为分叉不得结束在未闭合轮次内，而被编辑的消息替换其整个轮次。提交时路由到 `onSubmitEdit`：在边界处分叉、用子会话替换 live Agent、重放、并把编辑后的文本作为子会话的第一个轮次提交。第一轮内的消息（边界 -1）用全新会话替换当前会话。

## 后果

`overlay.ts` 的编辑浮层 reducer 与分叉边界折叠单元覆盖率 100%；`picker.spec.ts` 现在证明分叉经由 JSONL 后端持久化、携带 `parentSession` 血缘、且边界正确截断 seed。PTY e2e 编辑第二条消息、分叉，并断言编辑后的文本是子会话的第一个请求、且带 `parentSession` 链接的产物已持久化。同一持久化路径分叉也顺带修复了先前 `/fork` 与选择器分叉的采纳问题（它们共享 `forkSessionById`）。帮助文本与 README 记录该交互；Known Limitations 将编辑并分叉移出暂缓的 composer 事项。

## 备选方案

- **live store 的 detach/retire 缝隙**——分叉子会话的 live 条目由 fiber 持有且没有公开 detach，采纳需要新的核心生命周期 API；持久化写路径已然存在，零核心改动即可让子会话可续跑。
- **在消息 seq 处轮中分叉**——会话存储拒绝未闭合轮次内的边界（`OPEN_TURN`）；边界取前一个 `turn/start - 1`，seed 保持完整转录，被编辑的消息替换其轮次。
