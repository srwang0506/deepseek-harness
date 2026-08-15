# Agent Note：会话安全状态变得可见 —— /status、/permissions 与带 sandbox 的状态栏

Status: implemented

[English](2026-08-15-status-permissions-sandbox-visibility.md) | 中文

## 问题

Codex 对齐复查发现，TUI 无法回答每个用户在信任 Agent 之前都会问的问题：本会话运行在哪种 sandbox 模式下、应用哪种审批策略、模型实际看到什么。sandbox 模式与审批策略本就是持久化的会话事实（`sandbox/mode`、`approval/policy`、`permission/preset` 事件，重放时折叠），但没有任何终端 surface 渲染它们，安全相关的交互结构正围绕一个不可见的状态成形。

## 决策

**呈现持久化事实，不发明新状态。** 底部状态栏（位于带边框的 composer 输入行下方，Codex 式布局）常驻显示模型（含推理强度）、`ctx.sandboxPolicy.resolve({ session })` 给出的生效 sandbox 模式与权限预设。`/status` 报告完整会话状态——会话 id、模型与推理强度、`-m` 启动覆盖、cwd、带工作区根的 sandbox 模式、审批策略、带选项列表的权限预设、事件与 token 计数、OpenAI 登录状态。`/permissions [preset]` 显示生效预设与所有可用选项，或通过 `permissionPresets.set` 切换会话（一条 `permission/preset` + 各旋钮事件），并严格区分两种授权范围：审批提示的允许只针对单次操作，预设切换是续跑时恢复的持久化会话策略。

**纯函数行构建器 + 薄闭包。** `sessionStatusRows` 与 `permissionRows` 是对普通输入的导出纯函数；runner 闭包只把实时缝隙（sandbox 策略、审批覆盖、预设、token 计量、凭据存储）折叠进它们。

## 后果

两个构建器均有单元覆盖（行集合、覆盖标记、登录状态、预设标记）；PTY e2e 驱动 `/status`、`/permissions` 与 `/permissions read-only`，断言状态栏重渲染且 `sandbox/mode` + `permission/preset` 事件持久化。`dsh login status` 现在在 login 命令下报告登录状态，`dsh status` 只保留认证输出。composer 级 Codex 功能（模糊文件搜索、`Ctrl+R` 历史搜索、Vim 模式、Tab 排队、编辑并分叉）、`untrusted` 命令信任分类、额外可写目录与指令文件列表均在包 README 中记录为暂缓事项。

## 备选方案

- **为 /status 做模态浮层**——全屏浮层需要 store 并不拥有的焦点与关闭机制；行内行复用 /help 模式并保留在滚动记录中。
- **直接 `/sandbox <mode>` 切换**——预设表已经拥有 sandbox+审批组合；在 Codex 式独立开关到来之前，并行的仅 sandbox 旋钮会为同一个持久化事实制造两条写路径。
