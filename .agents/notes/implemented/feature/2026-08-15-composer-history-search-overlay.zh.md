# Agent Note：composer 浮层 —— 建立在 store 之上的模糊历史与项目文件搜索

Status: implemented

[English](2026-08-15-composer-history-search-overlay.md) | 中文

## 问题

composer 原先只能用 ↑↓ 逐条调出提交过的输入；Codex 的 `Ctrl+R` 是对提示词历史的实时搜索，且同样的交互将服务于 `@` 文件搜索。两者都需要一个带排序的模糊匹配器与一个小型浮层 surface，复用 composer 而不是再分叉出第二个输入。

## 决策

**纯模糊匹配器 + 纯浮层 reducer。** `fuzzyScore`/`fuzzyFilter`（`src/ui/fuzzy.ts`）按连续命中、边界加成与匹配起点给子序列匹配排序。`overlayKey`（`src/ui/overlay.ts`）把一次按键解析为对打开中浮层的更新：键入/退格经由匹配器重排候选集，↑/↓ 移动选择（循环），Enter 关闭并返回选中文本供 composer 采用，Esc/Ctrl+C 关闭但不插入。`openHistoryOverlay` 用 App 内已提交的输入历史初始化浮层，新的在前；输入行首 `@` 则以文件搜索打开同一个 reducer，候选来自惰性构建的项目文件索引（`buildFileIndex`：cwd 下所有未被忽略的文件，跳过隐藏条目、`node_modules`、`.git`、`.dsh` 与目录符号链接），文件插入会把末尾的 `@` 替换为完整的 `@path` 提及。

**store 持有浮层，App 持有候选源。** `UiStore.overlay` 持有一个 `{kind: 'history' | 'files', query, matches, selected}` 快照；App 把 rank 函数（历史行上的 `historyRank`，或 runner 在文件索引上的 `searchFiles`）传给 `overlayKey`，reducer 保持纯净，候选后端留在按键路径之外。浮层渲染在建议行与 composer 之间，Codex 式：一行标题与 `⏺` 标记行，选中项加粗。

## 后果

`fuzzy.ts`、`overlay.ts` 与 `file-index.ts` 单元覆盖率 100%；App 接线经由 ui-render 覆盖（Ctrl+R 与 `@` 打开、过滤、Enter 插入、Esc 关闭），PTY e2e 双场景：其一提交两行后用 `first` 过滤、复用该行并断言其成为第三个请求体；其二输入 `@`、过滤到 `tui-interactive.e2e.ts`、插入提及并断言该文件内容作为注入上下文到达模型。帮助文本与 README 记录 Ctrl+R；Known Limitations 把历史搜索移出暂缓的 composer 事项。

## 备选方案

- **复用会话选择器浮层**——选择器只选不输（无查询键入）；查询驱动的浮层需要自己的 reducer，后续与文件搜索共享。
- **子串匹配而非模糊匹配**——历史行是长文本；带边界加成的子序列排序能像 Codex 的搜索那样在 `git checkout --fix/…` 中找到 `fix`。
