# Agent Note：composer 光标编辑与 Vim normal 模式子集

Status: implemented

[English](2026-08-15-composer-vim-engine.md) | 中文

## 问题

composer 原本是只追加的字符串：输入只向末尾累加，Esc 直接清空整行，没有光标、没有行中编辑，写错一个字符只能全部清掉重来。Codex 对齐复查把输入体验列为最大差距——Codex 的 composer 是一个小型编辑器。

## 决策

**在 {text, cursor, vim} 之上的纯编辑引擎。** `src/ui/composer.ts` 中的 `applyComposerKey(edit, keyInput, key)` 解析所有无提示状态下的按键：insert 模式在光标处插入，backspace/Delete 围绕光标编辑，方向键移动光标，Enter 提交整行并复位，控制键（Ctrl+C/D/P/R/U、Tab、Shift+Tab）以上浮的 surface 意图返回。Esc 切换 Vim normal 模式，其中 `h`/`l`/`0`/`$`/`w`/`b` 移动，`x` 删除光标下字符，`D` 删除到行尾，`i`/`a`/`I`/`A` 在对应光标处回到 insert。Esc 因此不再清行；清行由 Ctrl+U 承担（与 Vim 自身一致）。

**多行粘贴是文本，不是提交。** 多于一行的大块输入原样插入——含尾部换行——而不会触发合并 Enter 路径；后者只对带尾部 `\r`/`\n` 的单行正文生效；随后 Enter 把整个 composer 作为一条消息提交。

**App 只负责渲染，不负责编辑。** App 持有一个 `ComposerEdit` 状态，无提示按键全部经由引擎路由（提示状态保留 `keyIntent`），光标渲染为反显字符（行尾显示块状 `█`）。同一 tick 内的连续按键先更新一个即时 ref 再交给 React 渲染，否则第二个 chunk 会编辑到过期文本。

## 后果

`composer.ts` 单元覆盖率 100%（19 个用例，含带与不带尾部换行的多行粘贴：光标处插入、backspace/Delete、边界钳制、单词动作、模式切换、提交、合并 Enter chunk、控制键）。PTY e2e 为无可见回显的按键新增了 `raw` 驱动操作，并新增场景：输入 `abcd`、Esc、`h`、`x`、Esc、`e`，断言 `abce` 到达模型。帮助文本与 README 记录键位；Known Limitations 将 Vim 模式移出暂缓的 composer 事项。

## 备选方案

- **Ink 的 `TextInput` 组件**——它拥有自己的 raw-mode 按键处理，会与 App 已经经由 `useInput` 路由的键流（steering、提示、选择器）分叉；纯引擎复用同一条按键路径。
- **完整 Vim（待决 `d` 命令、寄存器、visual 模式）**——行编辑器 surface 需要的是动作与模式切换，而非寄存器；子集是最小但完整的编辑体验，将来扩展待决命令状态无需改变 App 契约。
