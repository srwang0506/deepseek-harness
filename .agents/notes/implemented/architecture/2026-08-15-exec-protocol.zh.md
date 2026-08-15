# Agent Note：`dsh exec` 协议 — 版本化 JSONL、stdin 提示、输出 schema 与退出码

Status: implemented

[English](2026-08-15-exec-protocol.md) | 中文

## 问题

一次性 runner 只打印裸的最终文本；`--jsonl` 每个事件输出一行无版本的 `{type,data}`，没有信封、没有 result 行，调用方无法区分协议代际。任务只能以位置参数传入，管道用法（`cat prompt.txt | dsh exec`）不可行。对模型最终输出没有任何可机检的契约，且所有非完成结局共用退出码 1，脚本无法区分「模型失败」与「模型回答了但答案不符合要求的形状」。

## 决策

**版本化 JSONL。** `--jsonl` 输出版本化信封：首行 `{v:1,type:"init",sessionId,provider,model}`，根会话每个已提交事件一行 `{v:1,type,data}`，收尾 `{v:1,type:"result",ok,turnReason,error,...}`。每行都带 `v`，消费者可以逐行拒绝未知协议代际。

**stdin 提示。** 裸 `dsh exec` 解析为内部 `--stdin-task` 标志；runner 把完整管道 stdin 读作任务，stdin 为终端时以用法诊断失败。任务位置参数与 `--stdin-task` 在 startup 解析器中互斥。

**输出 schema 复用 harness 自带的校验器。** `--output-schema` 接受内联 JSON 或文件路径，用 `dsh-tools` 的 `assertSupportedJsonSchema`/`validateJsonSchemaValue` 校验最终 assistant 文本——与工具注册表使用同一个受支持的 JSON Schema 子集——而不是引入第二个校验器依赖。通过时把解析值以紧凑 JSON 打印；不匹配时向 stderr 打印违规行并以 2 退出。

**输出文件。** `-o/--output-file <path>` 把最终输出（文本、`--json` 对象或校验后的 schema 值）写入文件而非 stdout；与 `--jsonl` 组合是用法错误，因为流没有单一的最终输出。

**显式退出码。** 0 完成，1 其他结局，2 schema 不匹配——在 startup 帮助与 CLI 参考中记录。

## 后果

`runOneShot` 集中组装结果：一个 `jsonResult` 对象同时供给 `--json` 对象、JSONL `result` 行与文本/schema/文件路径，三种格式不会漂移。单元 bench 覆盖信封行、管道 stdin 提交、终端 stdin 拒绝、schema 通过/失败（退出 2）与文件输出；三个基于 execa 的 e2e 场景驱动真实启动器对 mock 服务器验证管道 stdin 与两种 schema 结局。`--stdin-task`/`--output-schema`/`-o` 与其他标志一样经由普通 `tuiStartup` 提供方与 bundle patch 映射传递。

## 备选方案

- **JSONL 只在首行标版本**：只标首行使中途加入的读者对后续每一行都无从判断；每行都盖 `v` 让每条记录自描述。
- **引入 ajv 作为校验依赖**：ajv 仅经由 MCP SDK 传递存在；复用 `dsh-tools` 的受支持 schema 校验器让工具参数与 exec 输出共用一套校验词汇，也避免新的 lockfile 边。
- **schema 不匹配复用退出码 1**：把两类不同失败坍缩为一，管道无法分别重试或上报。
