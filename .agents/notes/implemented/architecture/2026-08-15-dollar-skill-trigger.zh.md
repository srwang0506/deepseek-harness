# Agent Note：`$name` 技能触发 — 宿主侧调用复用模型自身的注入路径

Status: implemented

[English](2026-08-15-dollar-skill-trigger.md) | 中文

## 问题

终端没有用户侧调用技能的方式：只有模型能通过调用 `skill` 工具加载技能，因此想让某个技能的指令生效的用户只能请求模型去调用并寄望于它。Codex 的 `$skill-name` 提示触发恰好补上这一缺口，而 harness 已经拥有所需零件——`skill-invocation` 消息来源、`renderSkillContent` 与 `ctx.skills` 注册表。

## 决策

**`$name` token 解析为与 `skill` 工具完全相同的注入。** runner 扫描提交的提示中的 `$<kebab-case-name>` token（公开技能名语法），逐个经 `ctx.skills.get` 解析、检查 `isUserInvocable`，并在后续轮次前以规范来源 `{ kind: 'skill-invocation', name, form: 'instructions' }` 注入携带 `renderSkillContent(skill)` 的 `createUserMessage`。模型因此看到与工具路径完全相同的 `<skill_content>` 形状，请求日志记录相同的出处。未知或不允许用户调用的名字以错误行呈现并被跳过，绝不中断轮次。

**触发复用既有的「先注入后跟进」顺序**——与 `@path` 提及相同，技能正文恰好进入下一步预步骤的上下文一次，不额外唤醒轮次。

## 后果

`extractSkillInvocations` 已导出并获得单元覆盖（去重、顺序、含数字段、空 token）。PTY e2e 在 `$DSH_HOME/skills` 下播种一个扁平 Markdown 技能，依次驱动 `$nope`（错误行）与 `$demo-skill`（调用行），并断言技能正文到达模型请求。tui 组合包新增 `@deepseek-ai/dsh-skill` 依赖与项目引用；帮助与 README 记录该 token。

## 备选方案

- **把 `$name` 展开为 `skill` 工具调用**：需要用一次合成的工具调用往返来复现注入已经直接完成的事；工具仍是模型自己的动作。
- **用斜杠命令代替 token**：`/skill name` 割裂提示流；token 让调用留在提示行内，贴合 Codex 的肌肉记忆，也允许一行调用多个技能。
- **新增消息来源**：`skill-invocation` 已存在于 `MessageSourceMap`；复用它使出处与工具路径完全一致。
