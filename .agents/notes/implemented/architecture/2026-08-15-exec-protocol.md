# Agent Note: The `dsh exec` protocol — versioned JSONL, stdin prompts, output schemas, and exit codes

Status: implemented

English | [中文](2026-08-15-exec-protocol.zh.md)

## Problem

The one-shot runner printed a bare final text and, in `--jsonl`, an unversioned `{type,data}` line per event with no envelope, no result line, and no way for a caller to distinguish protocol generations. The task could only arrive as a positional, so pipelines (`cat prompt.txt | dsh exec`) were impossible. There was no machine-checkable contract on the model's final output, and every non-completed ending shared exit code 1, so scripts could not tell "the model failed" from "the model answered but the answer did not match the requested shape".

## Decision

**Versioned JSONL.** `--jsonl` emits a versioned envelope: a first `{v:1,type:"init",sessionId,provider,model}` line, one `{v:1,type,data}` line per committed root-session event, and a closing `{v:1,type:"result",ok,turnReason,error,...}` line. Every line carries `v`, so consumers can reject unknown protocol generations line by line.

**Stdin prompts.** A bare `dsh exec` resolves to the internal `--stdin-task` flag; the runner reads the complete piped stdin as the task and fails with a usage diagnostic when stdin is a terminal. The task positional and `--stdin-task` are mutually exclusive at the startup parser.

**Output schemas reuse the harness's own validator.** `--output-schema` accepts inline JSON or a file path and validates the final assistant text with `dsh-tools`'s `assertSupportedJsonSchema`/`validateJsonSchemaValue` — the same supported-JSON-Schema subset the tool registry uses — rather than adding a second validator dependency. A passing output prints the parsed value as compact JSON; a mismatch prints the violation lines to stderr and exits 2.

**Output files.** `-o/--output-file <path>` writes the final output (text, `--json` object, or validated schema value) to the file instead of stdout; combining it with `--jsonl` is a usage error because a stream has no single final output.

**Explicit exit codes.** 0 completed, 1 any other ending, 2 schema mismatch — documented in the startup help and the CLI reference.

## Consequences

`runOneShot` centralizes the result assembly: one `jsonResult` object feeds the `--json` object, the JSONL `result` line, and the text/schema/file paths, so the three formats cannot drift. The unit bench covers the envelope lines, piped-stdin submission, the terminal-stdin rejection, schema pass/fail (exit 2), and file output; three execa-based e2e scenarios drive the real launcher against the mock server for piped stdin and both schema outcomes. `--stdin-task`/`--output-schema`/`-o` flow through the ordinary `tuiStartup` provider and the bundle patch mapping like every other flag.

## Alternatives considered

- **A JSONL init-only version marker** — a version on just the first line leaves every later line ambiguous to a reader that joined mid-stream; stamping `v` on each line keeps each record self-describing.
- **Adding ajv as a validator dependency** — ajv is present only transitively via the MCP SDK; reusing `dsh-tools`'s supported-schema validator keeps one validation vocabulary across tool arguments and exec outputs and avoids a new lockfile edge.
- **Reusing exit code 1 for schema mismatch** — collapses two different failure classes into one, so pipelines cannot retry or report them distinctly.
