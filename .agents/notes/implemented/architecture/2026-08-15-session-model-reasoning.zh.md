# Agent Note：会话级模型与推理强度选择 — 会话日志是唯一事实来源

Status: implemented

[English](2026-08-15-session-model-reasoning.md) | 中文

## 问题

`/model` 切换的只是一个随进程消亡的内存选择：续跑会话时继续用配置的默认模型，而不是该会话最后使用的模型；推理强度则完全没有终端入口。每个会话的选择需要一个持久的存放处，而 settings.yaml 是错误的选择——它是部署/用户默认值，不是会话级状态。

## 决策

**从会话日志恢复，而不是从 settings。** 会话已经记录持久事实：`request/context` 事件折叠最新 provider/model 路由（`session.requestContext()`），每条 `request/header` 携带包含 `reasoningEffort` 的精确 `LlmCallConfig`。续跑时 runner 从这两个来源为 `ModelSelectionRef` 播种（`restoreSessionSelection`），使续跑会话沿用最后使用的模型与强度；状态栏立即显示恢复后的选择。

**`/reasoning [effort]` 切换同一个可变选择。** 裸 `/reasoning` 报告当前强度；参数设置适配器持有的强度（deepseek：`off`/`high`/`max`）；`off`、`none` 或 `default` 清除回 provider/默认行为。与 `/model` 一样，切换在下一轮生效，并经该轮的 `request/header` 持久化——没有后续轮次的切换不留可观察效果，与日志「记录已发生之事」的语义一致。

## 后果

`restoreSessionSelection` 已导出并获得单元覆盖（带强度的路由、不带强度的路由、无请求的会话）。PTY e2e 驱动 `/reasoning high` 并断言强度到达线上（首个请求体含 `reasoning_effort: high`），随后清除并完成第二轮。状态栏渲染强度后缀，`slashNames`/帮助列出 `/reasoning`。

## 备选方案

- **专用 `session/model` 事件**：路由与强度已经随每次请求持久记录（`request/context` + `request/header`），第二条记录会重复日志已拥有的状态；从日志恢复保持单一事实来源，也避免新增 `SessionEventMap` 成员及其 ignorable 标记机制。
- **把选择写入 settings.yaml**：settings 是所有会话共享的部署/用户默认值；把会话级状态写入会泄露一个会话的选择给所有其他会话。
- **轮次中途应用切换**：选择在提示词组装时捕获；中途切换会把提示词与请求路由劈开，这正是 `installModelSelection` 明确防止的。
