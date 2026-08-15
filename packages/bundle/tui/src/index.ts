/**
 * @deepseek-ai/dsh-tui — the Codex-style terminal client. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins. One-shot mode
 * (a task positional, reached via `dsh exec`) creates one Agent, drives it to
 * quiescence, and prints the final text; interactive mode mounts a full-screen
 * Ink UI that streams session events, answers approval/questions inline, and
 * handles slash commands. Both modes share one
 * {@link TerminalSessionController} for adoption, submission, steering,
 * cancellation, and flush-on-exit semantics.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { FileDiff } from '@deepseek-ai/dsh-tools/presentation'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { loginOpenAi, logoutOpenAi, PiAiCredentialStore } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-token-meter'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseSlash } from './slash.ts'
import { diffsFromMeta, plainFileDiffs } from './diff.ts'
import { extractText, toolCallTitle } from './present.ts'
import { completeMention, extractMentions, readMention, suggestMentions } from './mention.ts'
import { loadCustomCommands } from './custom-commands.ts'
import { UiStore } from './ui/store.ts'
import { mountApp } from './ui/app.tsx'
import type { AppCallbacks } from './ui/app.tsx'
import { TerminalSessionController } from './controller.ts'

export { TerminalSessionController } from './controller.ts'
export type { TerminalSessionCallbacks, TerminalSessionControllerOptions } from './controller.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the runner can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config, resolved from the ordinary tuiStartup provider. */
export interface Config {
  /** One-shot task text; empty string means interactive mode. */
  task: string
  /** Resume session id; empty string means a fresh session. */
  resumeSessionId: string
  /** Resume the most recent session. */
  continue: boolean
  /** `--model` override; empty string means the configured default. */
  model: string
  /** One-shot output format: plain text, a final JSON object, or streaming JSONL. */
  output: 'text' | 'json' | 'jsonl'
  /** Image files attached to the first user message (png/jpeg/webp/gif). */
  images: string[]
  /** Delete the persisted session after a one-shot run. */
  ephemeral: boolean
  /** Open the session picker instead of adopting a session at startup. */
  resumePicker: boolean
  /** Read the one-shot task from piped stdin instead of the positional. */
  stdinTask: boolean
  /** JSON Schema (inline JSON or a file path) the final output must match. */
  outputSchema: string
  /** Write the final output to this file instead of stdout. */
  outputFile: string
}

export const Config: z<Config> = z.object({
  task: z.string().default(''),
  resumeSessionId: z.string().default(''),
  continue: z.boolean().default(false),
  model: z.string().default(''),
  output: z.union([z.const('text'), z.const('json'), z.const('jsonl')]).default('text'),
  images: z.array(z.string()).default([]),
  ephemeral: z.boolean().default(false),
  resumePicker: z.boolean().default(false),
  stdinTask: z.boolean().default(false),
  outputSchema: z.string().default(''),
  outputFile: z.string().default(''),
})

/** The process streams the runner reads/writes; tests substitute captures. */
export const internals: {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown }
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
} = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): { text: string; reason: SessionEvent<'turn/end'>['data']['reason'] | undefined } {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Resolve the provider/model pair, applying a `--model` override (id or provider/id). */
function resolveSelection(
  defaultModel: { currentSelection(): { provider: string; model: string } },
  override: string,
): { provider: string; model: string } {
  const base = defaultModel.currentSelection()
  if (override === '') return base
  const slash = override.indexOf('/')
  if (slash > 0) return { provider: override.slice(0, slash), model: override.slice(slash + 1) }
  return { provider: base.provider, model: override }
}

/** Report an unexpected runner failure and request a failing exit. */
function fail(message: string, exit: (code: number) => void): void {
  internals.stderr.write(`dsh: ${message}\n`)
  exit(1)
}

/** The JSONL stream protocol version, stamped on every emitted line. */
const JSONL_VERSION = 1

/** Exit code for a final output that fails `--output-schema` validation. */
const SCHEMA_MISMATCH_EXIT = 2

/**
 * Read the complete piped stdin as the one-shot task text.
 * @param stdin - the process input stream.
 * @returns the trimmed task text.
 */
function readStdinTask(stdin: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<string> {
  if (stdin.isTTY === true) {
    return Promise.reject(new Error('exec: no task provided and stdin is a terminal; pass a task or pipe one in'))
  }
  return new Promise((resolve, reject) => {
    let text = ''
    stdin.on('data', (chunk: string | Buffer) => { text += typeof chunk === 'string' ? chunk : chunk.toString('utf8') })
    stdin.on('end', () => { resolve(text.trim()) })
    stdin.on('error', reject)
  })
}

/**
 * Parse the `--output-schema` argument: inline JSON, or a file path whose
 * content is the schema.
 * @param argument - the schema argument from the command line.
 * @returns the supported schema node.
 */
function loadOutputSchema(argument: string): JsonSchemaNode {
  const text = argument.trimStart().startsWith('{') ? argument : readFileSync(argument, 'utf8')
  const parsed: unknown = JSON.parse(text)
  assertSupportedJsonSchema(parsed)
  return parsed
}

/**
 * Validate the final assistant text against the requested schema.
 * @param schema - the supported schema node.
 * @param text - the final output text.
 * @returns the parsed value, or the violation lines when it does not match.
 */
function validateFinalOutput(schema: JsonSchemaNode, text: string): { value: unknown } | { violations: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { violations: ['output is not valid JSON'] }
  }
  const violations = validateJsonSchemaValue(schema, parsed)
  return violations.length === 0 ? { value: parsed } : { violations }
}

/** One-shot mode (`dsh exec`): drive one task and print its final assistant text. */
async function runOneShot(ctx: Context, config: Config, exit: (code: number) => void): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return
  const selection = resolveSelection(defaultModel, config.model)
  const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined }
  if (config.outputFile !== '' && config.output === 'jsonl') {
    internals.stderr.write('dsh: --output-file cannot stream --jsonl; drop one of the two\n')
    exit(1)
    return
  }
  const taskText = config.stdinTask ? await readStdinTask(internals.stdin) : config.task

  // JSONL mode streams one versioned line per committed session event after
  // submission; events committed before submission (resume replay) are
  // skipped. The first line is the init envelope, the last the result.
  let firstSeq = Number.POSITIVE_INFINITY
  const controller = new TerminalSessionController({
    ctx,
    selectionRef,
    callbacks: {
      onEvent: (session, event) => {
        if (config.output !== 'jsonl') return
        if (session.id !== controller.live()?.id) return
        if (event.seq < firstSeq) return
        internals.stdout.write(`${JSON.stringify({ v: JSONL_VERSION, type: event.type, data: event.data })}\n`)
      },
      askApproval: () => Promise.resolve<ApprovalOutcome>('rejected'),
      askQuestions: () => Promise.resolve({ answers: [] }),
    },
  })
  const agent = await controller.start(config.resumeSessionId)
  firstSeq = agent.session.seq
  if (config.output === 'jsonl') {
    internals.stdout.write(`${JSON.stringify({
      v: JSONL_VERSION,
      type: 'init',
      sessionId: agent.id,
      provider: selection.provider,
      model: selection.model,
    })}\n`)
  }
  const blocks = await imageBlocks(ctx, config.images)
  await controller.submit(createUserMessage({
    content: [{ type: 'text', text: taskText }, ...blocks],
    source: { kind: 'user' },
  }))
  const outcome = summarize(agent.session.events, firstSeq)
  const reason = outcome.reason
  const jsonResult = {
    ok: reason?.kind === 'completed',
    sessionId: agent.id,
    provider: selection.provider,
    model: selection.model,
    text: outcome.text,
    turnReason: reason?.kind ?? null,
    error: reason?.kind === 'error' ? { code: reason.error.code, message: reason.error.message } : null,
  }
  let finalOutput: string | undefined
  if (config.output === 'jsonl') {
    internals.stdout.write(`${JSON.stringify({ v: JSONL_VERSION, type: 'result', ...jsonResult })}\n`)
  } else if (config.output === 'json') {
    finalOutput = `${JSON.stringify(jsonResult)}\n`
  } else if (config.outputSchema !== '') {
    const schema = loadOutputSchema(config.outputSchema)
    const checked = validateFinalOutput(schema, outcome.text)
    if ('violations' in checked) {
      internals.stderr.write(`dsh: output does not match the requested schema:\n${checked.violations.map(v => `  - ${v}`).join('\n')}\n`)
      await controller.shutdown()
      exit(SCHEMA_MISMATCH_EXIT)
      return
    }
    finalOutput = `${JSON.stringify(checked.value)}\n`
  } else {
    finalOutput = outcome.text + '\n'
    if (reason?.kind === 'error') {
      internals.stderr.write(`dsh: ${reason.error.code}: ${reason.error.message}\n`)
    }
  }
  if (finalOutput !== undefined) {
    if (config.outputFile === '') internals.stdout.write(finalOutput)
    else writeFileSync(config.outputFile, finalOutput)
  }
  await controller.shutdown()
  if (config.ephemeral) {
    const persistence = ctx.get('sessionPersistence')
    if (persistence !== undefined) await persistence.delete(SessionId(agent.id))
  }
  exit(reason?.kind === 'completed' ? 0 : 1)
}

/** The most recent non-subagent persisted session id, or empty string. */
async function mostRecentSession(ctx: Context): Promise<string> {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return ''
  const headers = await persistence.list()
  const candidates = headers.filter(header => header.origin !== 'subagent')
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  return candidates[0]?.id ?? ''
}

/**
 * List the sessions the picker offers, newest first, skipping subagents.
 * @param ctx - plugin context carrying the query/persistence services.
 * @returns picker rows: id, folded title, cwd, creation time, and live flag.
 */
export async function pickerSessions(ctx: Context): Promise<Array<{
  id: string
  title: string | undefined
  cwd: string | undefined
  createdAt: number
  live: boolean
}>> {
  const query = ctx.get('sessionQuery')
  const records = query !== undefined ? await query.listSessions() : []
  const persistence = ctx.get('sessionPersistence')
  const headers: SessionHeader[] = records.length > 0
    ? records.map(record => record.header)
    : (await persistence?.list() ?? [])
  const candidates = headers.filter(header => header.origin !== 'subagent')
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  const titles = new Map<string, string>()
  if (query !== undefined && candidates.length > 0) {
    const folded = await query.readTitleSnapshots(candidates.map(header => SessionId(header.id)))
    for (let index = 0; index < candidates.length; index++) {
      const result = folded[index]
      const header = candidates[index]
      if (result !== undefined && result.status === 'fulfilled' && header !== undefined) {
        const snapshot = result.value.title
        if (snapshot !== undefined) titles.set(header.id, snapshot.title)
      }
    }
  }
  return candidates.map(header => ({
    id: header.id,
    title: titles.get(header.id),
    cwd: header.cwd,
    createdAt: header.createdAt,
    live: records.some(record => record.header.id === header.id && record.live),
  }))
}

/**
 * Fork one session by id: live sessions fork directly; persisted sessions
 * load through the agents registry, fork, and dispose the loaded source.
 * @param ctx - plugin context carrying the sessions/agents registries.
 * @param id - the session to fork.
 * @returns the child session id.
 */
export async function forkSessionById(ctx: Context, id: string): Promise<string> {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('tui-runner: the sessions registry is not mounted')
  const live = sessions.get(SessionId(id))
  if (live !== undefined) return sessions.fork(live).id
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error('tui-runner: the agents registry is not mounted')
  const handle = await agents.resume({ resumeSessionId: SessionId(id), agentOptions: {}, setup: () => {} })
  try {
    return sessions.fork(handle.agent.session).id
  } finally {
    await handle.dispose()
  }
}

/** Default AGENTS.md written by /init when none exists. */
const AGENTS_TEMPLATE = '# AGENTS.md\n\nInstructions for AI coding agents working in this repository.\n\nAdd project-specific conventions, commands, and guidelines here.\n'

/** The plain-text slash-command help. */
function helpText(): string {
  return [
    'Commands:',
    '  /new              start a fresh session',
    '  /resume [id]      open the session picker, or resume the given id',
    '  /model [model]    show the model, or switch it',
    '  /login [method]   log into OpenAI GPT (browser, device, api-key)',
    '  /logout           remove the OpenAI GPT credential',
    '  /sessions         list persisted sessions',
    '  /fork             fork the current session from its latest event',
    '  /delete [id]      delete a persisted session',
    '  /status           show model, session, cwd, and login state',
    '  /compact          compact the session history',
    '  /init             write an AGENTS.md template',
    '  /doctor           check environment and credentials',
    '  /export [file]    export the session log as JSONL',
    '  /diff             show this session\'s file changes',
    '  /review           review this session\'s file changes for bugs',
    '  /undo             revert the most recent file change',
    '  /help             show this help',
    '  /quit, /exit      exit',
    'Keys: Shift+Tab cycles the permission preset; Ctrl+P toggles plan mode; Ctrl+C cancels the turn.',
    'Keys: Ctrl+D quits and flushes; typed input during a run steers the agent at its next step.',
    'A !-prefixed line runs a local shell command, e.g. !git status.',
    'Custom commands: $DSH_HOME/commands/<name>.md (prompt template with $ARGUMENTS).',
  ].join('\n')
}

/** The plain-text turn-end status for a non-completed ending. */
function turnEndText(reason: TurnEndReason): string | undefined {
  switch (reason.kind) {
    case 'aborted':
    case 'interrupted':
      return '(interrupted)'
    case 'blocked':
      return '(blocked)'
    case 'max-tokens':
      return '(max tokens reached)'
    case 'error':
      return `${reason.error.code}: ${reason.error.message}`
    default:
      return undefined
  }
}

/**
 * Render one committed session event into the UI store.
 * @param event - the committed event.
 * @param store - the UI store receiving the rendered row.
 */
export function streamEventToStore(event: SessionEvent, store: UiStore): void {
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') store.appendText('assistant', chunk.text)
      else if (chunk.type === 'reasoning-delta') store.appendText('reasoning', chunk.text)
      return
    }
    case 'tool/call':
      store.push({ kind: 'tool', text: toolCallTitle(event.data.name, event.data.arguments) })
      return
    case 'tool/result': {
      const diffs = diffsFromMeta(event.data.meta)
      if (diffs !== undefined) {
        const text = plainFileDiffs(diffs)
        if (text !== '') store.push({ kind: 'diff', text })
      } else {
        const text = extractText(event.data.message.content)
        if (text !== '') store.push({ kind: 'tool', text })
      }
      return
    }
    case 'turn/end': {
      const text = turnEndText(event.data.reason)
      if (text !== undefined) store.push({ kind: 'error', text })
      return
    }
    default:
      return
  }
}

/**
 * Render one subagent session event as a labeled background row. Subagents do
 * not stream deltas; only tool calls, the final message, and failures show.
 * @param event - the subagent session event.
 * @param store - the UI store receiving the rendered row.
 * @param label - the `[subagent …]` prefix.
 */
function streamSubagentEventToStore(event: SessionEvent, store: UiStore, label: string): void {
  switch (event.type) {
    case 'tool/call':
      store.push({ kind: 'tool', text: `${label} ${toolCallTitle(event.data.name, event.data.arguments)}` })
      return
    case 'assistant/message': {
      const text = textOf(event.data.message.content)
      if (text !== '') store.push({ kind: 'info', text: `${label} ${text}` })
      return
    }
    case 'turn/end': {
      const text = turnEndText(event.data.reason)
      if (text !== undefined) store.push({ kind: 'error', text: `${label} ${text}` })
      return
    }
    default:
      return
  }
}

/** Join the visible text blocks of a message. */
function textOf(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
}

/**
 * Render one persisted event for a resumed transcript.
 * @param event - the persisted event.
 * @param store - the UI store receiving the rendered row.
 */
export function replayEventToStore(event: SessionEvent, store: UiStore): void {
  switch (event.type) {
    case 'user/message': {
      const text = textOf(event.data.content)
      if (text !== '') store.push({ kind: 'user', text })
      return
    }
    case 'assistant/message': {
      const text = textOf(event.data.message.content)
      if (text !== '') store.push({ kind: 'assistant', text })
      return
    }
    default:
      streamEventToStore(event, store)
  }
}

/** Serialize approval/question prompts so parallel tool calls cannot interleave reads. */
function makePromptQueue(): { run<T>(fn: () => Promise<T>): Promise<T> } {
  let chain: Promise<void> = Promise.resolve()
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = chain.then(fn, fn)
      chain = result.then(() => undefined, () => undefined)
      return result
    },
  }
}

/**
 * Ask a closed single-key choice; the prompt clears itself on the answer, and
 * a null answer means the human dismissed it (Esc, Ctrl+D, or turn cancel).
 * @param store - the UI store the prompt renders through.
 * @param question - the prompt line.
 * @param choices - the accepted single-character keys.
 */
function askChoice(store: UiStore, question: string, choices: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    store.setPrompt({
      kind: 'choice',
      question,
      choices,
      answer: (key) => { store.setPrompt(undefined); resolve(key) },
    })
  })
}

/**
 * Ask free text, optionally with instant number shortcuts that answer only
 * from an empty buffer; `multiLine` collects lines until an empty one.
 * @param store - the UI store the prompt renders through.
 * @param question - the prompt line.
 * @param choices - instant shortcut keys (preset option numbers).
 * @param multiLine - collect until an empty line instead of one Enter.
 */
function askText(store: UiStore, question: string, choices: readonly string[], multiLine: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    store.setPrompt({
      kind: 'text',
      question,
      choices,
      multiLine,
      answer: (text) => { store.setPrompt(undefined); resolve(text) },
    })
  })
}

/**
 * Prompt the user to allow or reject one approval; a null answer (Esc,
 * Ctrl+D, or turn cancel) means the request was dismissed as cancelled.
 * @param store - the UI store the prompt renders through.
 * @param toolName - the tool the approval gates.
 * @param reason - the asker's human-readable explanation, if any.
 * @returns the closed outcome: allow, reject, or cancelled for a dismissal.
 */
export async function promptApproval(store: UiStore, toolName: string, reason: string | undefined): Promise<ApprovalOutcome> {
  const question = reason === undefined ? `Run ${toolName}? [y/N]` : `Run ${toolName} — ${reason}? [y/N]`
  const key = await askChoice(store, question, ['y', 'n'])
  if (key === 'y') return 'allowed-once'
  if (key === null) return 'cancelled'
  return 'rejected'
}

/**
 * Split one submitted answer line into selected option labels and leftover
 * custom text: numeric tokens in range select presets, everything else (and
 * out-of-range numbers) is the human's own answer.
 * @param line - the submitted answer text.
 * @param options - the question's preset options.
 */
function parseOptionAnswer(line: string, options: readonly AskUserQuestionOption[]): { selected: string[]; custom: string | undefined } {
  const selected: string[] = []
  const leftover: string[] = []
  for (const token of line.split(/[,\s]+/)) {
    if (token === '') continue
    if (/^\d+$/.test(token)) {
      const index = Number(token)
      const option = index >= 1 && index <= options.length ? options[index - 1] : undefined
      if (option !== undefined) {
        selected.push(option.label)
        continue
      }
    }
    leftover.push(token)
  }
  const custom = leftover.join(' ').trim()
  return { selected, custom: custom === '' ? undefined : custom }
}

/**
 * Ask every question in one request, serially. Preset options accept their
 * numbers, typed custom answers, or both (multi-select); option-free
 * questions take multi-line free text.
 * @param store - the UI store the prompts render through.
 * @param questions - the questions to answer, in order.
 * @returns the structured answers, one item per question.
 */
export async function promptQuestions(store: UiStore, questions: readonly AskUserQuestionItem[]): Promise<AskUserQuestionAnswer> {
  const answers: AskUserQuestionAnswer['answers'] = []
  for (const question of questions) {
    const options = question.options ?? []
    store.push({ kind: 'info', text: question.header === undefined ? question.question : `${question.header}: ${question.question}` })
    if (question.detail !== undefined) store.push({ kind: 'info', text: question.detail })
    if (options.length === 0) {
      const text = await askText(store, `${question.question} `, [], true)
      answers.push({ id: question.id, selected: [], ...(text === null ? {} : { custom: text }) })
      continue
    }
    options.forEach((option, index) => { store.push({ kind: 'info', text: `  ${index + 1}. ${option.label}` }) })
    // Instant number shortcuts only while single digits stay unambiguous.
    const shortcuts = options.length <= 9 ? options.map((_, index) => String(index + 1)) : []
    const suffix = shortcuts.length === 0 ? '' : ` (${shortcuts.join('/')}, or type your own)`
    const text = await askText(store, question.multiSelect === true
      ? 'choose numbers, your own answer, or both'
      : `choose${suffix}`, shortcuts, false)
    if (text === null) {
      answers.push({ id: question.id, selected: [] })
      continue
    }
    const parsed = parseOptionAnswer(text, options)
    answers.push({ id: question.id, selected: parsed.selected, ...(parsed.custom === undefined ? {} : { custom: parsed.custom }) })
  }
  return { answers }
}

/** Cycle the live permission preset (sandbox mode + approval policy). */
function cyclePermissionPreset(ctx: Context, agent: Agent | undefined, store: UiStore): void {
  if (agent === undefined) return
  const presets = ctx.get('permissionPresets')
  if (presets === undefined) return
  const names = presets.names
  if (names.length === 0) return
  const current = presets.current(agent.session.events)
  const index = names.indexOf(current)
  const next = names[(index + 1) % names.length] ?? current
  presets.set(agent.session, next)
  store.push({ kind: 'info', text: `permission ${next}` })
}

/** Toggle plan mode for the live agent. */
function togglePlanMode(ctx: Context, agent: Agent | undefined, store: UiStore): void {
  if (agent === undefined) return
  const planMode = ctx.get('planMode')
  if (planMode === undefined) return
  const active = planMode.get(agent).active
  planMode.set(agent, !active)
  store.push({ kind: 'info', text: `plan mode ${active ? 'off' : 'on'}` })
}

/** The status-bar text: model, permission preset, and plan mode. */
function statusText(selection: { provider: string; model: string }, ctx: Context, agent: Agent): string {
  const parts = [`${selection.provider}/${selection.model}`]
  const meter = ctx.get('tokenMeter')
  if (meter !== undefined) parts.push(`${meter.measure(agent.session).totalTokens} tokens`)
  const presets = ctx.get('permissionPresets')
  if (presets !== undefined) parts.push(presets.current(agent.session.events))
  const planMode = ctx.get('planMode')
  if (planMode !== undefined && planMode.get(agent).active) parts.push('plan')
  return parts.join(' · ')
}

/** Collect every file diff a tool recorded in this session, in log order. */
function collectDiffs(session: Session): FileDiff[] {
  const diffs: FileDiff[] = []
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const meta = diffsFromMeta(event.data.meta)
    if (meta !== undefined) diffs.push(...meta)
  }
  return diffs
}

/** Register user-defined prompt-template commands from `$DSH_HOME/commands`. */
function registerCustomCommands(ctx: Context): void {
  const commands = ctx.get('commands')
  if (commands === undefined) return
  for (const command of loadCustomCommands(join(resolveDshHome(), 'commands'))) {
    commands.register({
      name: command.name,
      description: command.description,
      handler: ({ agent, rawInput }) => {
        const args = rawInput.trim()
        const prompt = command.template.includes('$ARGUMENTS')
          ? command.template.replaceAll('$ARGUMENTS', args)
          : (command.template + '\n' + args).trim()
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        }))
        return { kind: 'success' }
      },
    })
  }
}

/** The built-in slash-command names plus every registry command. */
function slashNames(ctx: Context, agent: Agent): string[] {
  const names = new Set(['new', 'fork', 'delete', 'resume', 'model', 'login', 'logout', 'sessions', 'status', 'compact', 'init', 'doctor', 'export', 'diff', 'review', 'undo', 'help', 'quit', 'exit'])
  const commands = ctx.get('commands')
  if (commands !== undefined) {
    for (const descriptor of commands.list(agent)) names.add(descriptor.name)
  }
  return [...names].sort()
}

/** Suggest slash commands or @-paths for the current line. */
function suggestionsFor(ctx: Context, agent: Agent, line: string, cursor: number): string[] {
  if (cursor !== line.length) return []
  if (line.startsWith('/')) {
    const word = line.slice(1).split(/\s/)[0] ?? ''
    return slashNames(ctx, agent).filter(name => name.startsWith(word)).map(name => '/' + name)
  }
  return suggestMentions(line, cursor, process.cwd())
}

/**
 * Run one `!`-prefixed line as a local shell command and record its output.
 * @param command - the command text after `!`.
 * @param store - the UI store the output rows land in.
 */
async function runLocalCommand(command: string, store: UiStore): Promise<void> {
  if (command === '') {
    store.push({ kind: 'info', text: '! needs a command, e.g. !git status' })
    return
  }
  store.push({ kind: 'info', text: `$ ${command}` })
  await new Promise<void>((resolvePromise) => {
    const child = spawn(command, { cwd: process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.once('error', (error) => {
      store.push({ kind: 'error', text: error.message })
      resolvePromise()
    })
    child.once('close', (code) => {
      const text = output.trimEnd()
      if (text !== '') store.push({ kind: 'info', text })
      store.push({ kind: 'info', text: `exit ${code ?? 'unknown'}` })
      resolvePromise()
    })
  })
}

/** Accepted raster media type for one image path, by extension. */
function mediaTypeOf(path: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  const extension = basename(path).slice(basename(path).lastIndexOf('.') + 1).toLowerCase()
  switch (extension) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return undefined
  }
}

/**
 * Read and durably commit each `--image` file through the attachment service.
 * @param ctx - plugin context carrying the attachment store.
 * @param paths - image file paths in argv order.
 * @returns the image content blocks for the first user message.
 */
async function imageBlocks(ctx: Context, paths: readonly string[]): Promise<ImageBlock[]> {
  const attachments = ctx.get('attachments')
  const blocks: ImageBlock[] = []
  for (const path of paths) {
    if (attachments === undefined) throw new Error('tui-runner: the attachment service is not mounted')
    const mediaType = mediaTypeOf(path)
    if (mediaType === undefined) throw new Error(`unsupported image type for ${path} (use png, jpeg, webp, or gif)`)
    const bytes = await readFile(path)
    const attachment = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name: basename(path) })
    blocks.push({ type: 'image', attachment })
  }
  return blocks
}

/** Interactive mode: mount the full-screen Ink app and drive the agent. */
async function runInteractive(ctx: Context, config: Config, exit: (code: number) => void): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  if (!internals.stdin.isTTY) {
    internals.stderr.write('dsh: no task provided and stdin is not a terminal; pass a task for one-shot mode\n')
    exit(1)
    return
  }

  let selection = resolveSelection(defaultModel, config.model)
  const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined }
  let resumeSessionId = config.resumeSessionId
  if (resumeSessionId === '' && config.continue) {
    resumeSessionId = await mostRecentSession(ctx)
    if (resumeSessionId === '') {
      internals.stderr.write('dsh: no persisted session to continue\n')
      exit(1)
      return
    }
  }

  const store = new UiStore()
  const promptQueue = makePromptQueue()
  // Engage raw mode eagerly: Ink enables it through a passive effect that
  // some environments flush lazily, and a first keystroke landing in
  // canonical mode would coalesce the typed line with its Enter.
  internals.stdin.setRawMode?.(true)
  const controller = new TerminalSessionController({
    ctx,
    selectionRef,
    callbacks: {
      onEvent: (session, event) => {
        if (session === controller.live()?.session) streamEventToStore(event, store)
        else streamSubagentEventToStore(event, store, `[subagent ${session.id.slice(-8)}]`)
      },
      askApproval: (toolName, reason) => promptQueue.run(() => promptApproval(store, toolName, reason)),
      askQuestions: questions => promptQueue.run(() => promptQuestions(store, questions)),
      onRunningChange: (running) => { store.setRunning(running) },
      onAdopt: (agent, resumed) => {
        if (resumed) {
          for (const event of agent.session.events) replayEventToStore(event, store)
        }
      },
    },
  })

  registerCustomCommands(ctx)

  const refreshStatus = (): void => {
    const agent = controller.live()
    if (agent !== undefined) store.setStatus(statusText(selection, ctx, agent))
  }

  let quitResolve: (() => void) | undefined
  const quitPromise = new Promise<void>((resolve) => { quitResolve = resolve })

  /** Open the session picker, or fall back to a fresh session when nothing is persisted. */
  const openPicker = async (): Promise<void> => {
    const candidates = await pickerSessions(ctx)
    if (candidates.length === 0) {
      store.push({ kind: 'info', text: '(no persisted sessions)' })
      if (controller.live() === undefined) {
        await controller.start('')
        refreshStatus()
      }
      return
    }
    store.setPicker({ items: candidates, selected: 0 })
  }

  /** Adopt one picker selection, forking it first when asked. */
  const adoptFromPicker = async (id: string, forkFirst: boolean): Promise<void> => {
    store.setPicker(undefined)
    if (forkFirst) {
      const childId = await forkSessionById(ctx, id)
      await controller.replace(childId)
      refreshStatus()
      store.push({ kind: 'info', text: `forked ${childId} from ${id}` })
      return
    }
    await controller.replace(id)
    refreshStatus()
    store.push({ kind: 'info', text: `resumed session ${id}` })
  }
  // `--image` files attach to the first submitted message, then are consumed.
  let pendingImages: readonly string[] = config.images

  /** Handle one submitted line: a slash command, a mention, or a plain prompt. */
  const handleLine = async (line: string): Promise<void> => {
    const agent = controller.live()
    if (agent === undefined) return
    if (line.startsWith('!')) {
      await runLocalCommand(line.slice(1).trim(), store)
      return
    }
    const slash = parseSlash(line)
    if (slash !== undefined) {
      switch (slash.name) {
        case 'quit':
        case 'exit':
          quitResolve?.()
          return
        case 'help':
          store.push({ kind: 'info', text: helpText() })
          return
        case 'new':
          await controller.replace('')
          refreshStatus()
          store.push({ kind: 'info', text: 'started a fresh session' })
          return
        case 'model': {
          if (slash.args === '') {
            const llm = ctx.get('llm')
            const routes = llm?.listConfigurableProviders() ?? []
            store.push({ kind: 'info', text: `model ${selection.provider}/${selection.model} (current)` })
            if (routes.length > 0) {
              store.push({
                kind: 'info',
                text: `providers: ${routes.map(route => route.displayName === route.provider ? route.provider : `${route.provider} (${route.displayName})`).sort().join(', ')}`,
              })
            }
            store.push({ kind: 'info', text: 'switch with /model <provider>/<model>, e.g. /model deepseek-official/deepseek-v4-flash' })
          } else {
            selection = resolveSelection(defaultModel, slash.args)
            selectionRef.current = selection
            store.push({ kind: 'info', text: `model set to ${selection.provider}/${selection.model} (next turn)` })
          }
          refreshStatus()
          return
        }
        case 'login': {
          const method = slash.args.trim()
          await suspendSurface(() => loginOpenAi(dshHomePath('pi-ai-auth.json'), method === '' ? undefined : method))
          refreshStatus()
          return
        }
        case 'logout': {
          await suspendSurface(() => logoutOpenAi(dshHomePath('pi-ai-auth.json')))
          refreshStatus()
          return
        }
        case 'sessions': {
          const headers = await ctx.get('sessionPersistence')?.list() ?? []
          const rows = headers.filter(h => h.origin !== 'subagent').sort((a, b) => b.createdAt - a.createdAt)
          if (rows.length === 0) {
            store.push({ kind: 'info', text: '(no persisted sessions)' })
            return
          }
          for (const header of rows.slice(0, 20)) {
            const marker = header.id === agent.id ? ' *' : ''
            store.push({ kind: 'info', text: `${header.id}${marker}  ${new Date(header.createdAt).toLocaleString()}${header.cwd === undefined ? '' : `  ${header.cwd}`}` })
          }
          if (rows.length > 20) store.push({ kind: 'info', text: `… and ${rows.length - 20} more` })
          return
        }
        case 'fork': {
          const child = sessions.fork(agent.session)
          const parentId = agent.id
          await controller.replace(child.id)
          refreshStatus()
          store.push({ kind: 'info', text: `forked ${child.id} from ${parentId}` })
          return
        }
        case 'delete': {
          const id = slash.args.trim()
          if (id === '') {
            store.push({ kind: 'error', text: '/delete needs a session id (see /sessions)' })
            return
          }
          if (id === agent.id) {
            store.push({ kind: 'error', text: 'cannot delete the live session; run /new first' })
            return
          }
          const persistence = ctx.get('sessionPersistence')
          if (persistence === undefined) {
            store.push({ kind: 'error', text: 'session persistence is not mounted' })
            return
          }
          try {
            await persistence.delete(SessionId(id))
            store.push({ kind: 'info', text: `deleted session ${id}` })
          } catch (error) {
            store.push({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        case 'resume': {
          if (slash.args === '') {
            await openPicker()
            return
          }
          await controller.replace(slash.args)
          refreshStatus()
          store.push({ kind: 'info', text: `resumed session ${slash.args}` })
          return
        }
        case 'status': {
          const context = agent.session.requestContext()
          store.push({ kind: 'info', text: `session ${agent.id}` })
          store.push({ kind: 'info', text: `model ${context?.provider ?? selection.provider}/${context?.model ?? selection.model}` })
          store.push({ kind: 'info', text: `cwd ${process.cwd()}` })
          store.push({ kind: 'info', text: `events ${agent.session.seq}` })
          const credentials = new PiAiCredentialStore(dshHomePath('pi-ai-auth.json'))
          const credential = await credentials.read('openai-codex')
          store.push({
            kind: 'info',
            text: credential?.type === 'oauth'
              ? 'OpenAI 已通过 ChatGPT OAuth 登录'
              : credential?.type === 'api_key'
                ? 'OpenAI 已通过 API Key 登录'
                : 'OpenAI 尚未登录',
          })
          return
        }
        case 'init': {
          const path = join(process.cwd(), 'AGENTS.md')
          if (existsSync(path)) {
            store.push({ kind: 'info', text: 'AGENTS.md already exists' })
          } else {
            writeFileSync(path, AGENTS_TEMPLATE)
            store.push({ kind: 'info', text: `wrote ${path}` })
          }
          return
        }
        case 'doctor': {
          const rows: ReadonlyArray<readonly [string, string]> = [
            ['node', process.version],
            ['model', `${selection.provider}/${selection.model}`],
            ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY === undefined ? 'not set' : 'set'],
            ['commands', ctx.get('commands') === undefined ? 'unavailable' : 'available'],
          ]
          for (const [label, value] of rows) store.push({ kind: 'info', text: `${label.padEnd(18)} ${value}` })
          return
        }
        case 'diff': {
          const diffs = collectDiffs(agent.session)
          if (diffs.length === 0) {
            store.push({ kind: 'info', text: 'no file changes in this session' })
          } else {
            store.push({ kind: 'diff', text: plainFileDiffs(diffs) })
          }
          return
        }
        case 'review': {
          const diffs = collectDiffs(agent.session)
          if (diffs.length === 0) {
            store.push({ kind: 'info', text: 'no file changes in this session to review' })
            return
          }
          const prompt = 'Review the following changes from this session for bugs, style issues, and missing tests:\n\n'
            + diffs.map(diff => `## ${diff.path}\n${diff.newText}`).join('\n\n')
          store.push({ kind: 'user', text: '/review' })
          await controller.submit(createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' },
          }))
          refreshStatus()
          return
        }
        case 'undo': {
          const last = collectDiffs(agent.session).at(-1)
          if (last === undefined) {
            store.push({ kind: 'info', text: 'nothing to undo' })
            return
          }
          const path = join(process.cwd(), last.path)
          if (last.oldText === null) {
            rmSync(path, { force: true })
            store.push({ kind: 'info', text: `removed ${last.path}` })
          } else {
            writeFileSync(path, last.oldText)
            store.push({ kind: 'info', text: `reverted ${last.path}` })
          }
          return
        }
        case 'export': {
          const file = slash.args.trim() === '' ? `session-${agent.id}.jsonl` : slash.args.trim()
          const path = join(process.cwd(), file)
          const lines = agent.session.events.map(event => JSON.stringify(event))
          writeFileSync(path, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
          store.push({ kind: 'info', text: `exported ${agent.session.events.length} events to ${path}` })
          return
        }
        default: {
          const commands = ctx.get('commands')
          if (commands !== undefined) {
            try {
              const execution = await commands.execute(agent, line, new AbortController().signal)
              if (execution !== undefined) {
                if (execution.result.text !== undefined) {
                  store.push({ kind: execution.result.kind === 'error' ? 'error' : 'info', text: execution.result.text })
                }
                await controller.settle()
                refreshStatus()
                return
              }
            } catch (error) {
              store.push({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
              return
            }
          }
          store.push({ kind: 'error', text: `unknown command /${slash.name} — try /help` })
          return
        }
      }
    }
    if (line.trim() === '') return
    for (const path of extractMentions(line)) {
      const mention = readMention(path, process.cwd())
      if (mention === undefined) continue
      const suffix = mention.truncated ? ' (truncated)' : ''
      controller.inject(createUserMessage({
        content: [{ type: 'text', text: `Content of ${mention.path}${suffix}:\n${mention.content}` }],
        source: { kind: 'plugin', plugin: 'tui-mention' },
      }))
    }
    const blocks = await imageBlocks(ctx, pendingImages)
    pendingImages = []
    store.push({ kind: 'user', text: line })
    // While a turn runs, a submitted line steers the agent at its next step
    // instead of queueing a second turn.
    await controller.submit(createUserMessage({
      content: [{ type: 'text', text: line }, ...blocks],
      source: { kind: 'user' },
    }))
    refreshStatus()
  }

  const callbacks: AppCallbacks = {
    onSubmit: (line) => {
      void handleLine(line).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error), exit)
      })
    },
    onQuit: () => {
      // Let the current input/render pass settle before the finally block
      // unmounts the Ink surface underneath it.
      setImmediate(() => { quitResolve?.() })
    },
    onCycleApproval: () => { cyclePermissionPreset(ctx, controller.live(), store); refreshStatus() },
    onTogglePlan: () => { togglePlanMode(ctx, controller.live(), store); refreshStatus() },
    onComplete: (line, cursor) => completeMention(line, cursor, process.cwd()),
    onCancel: () => {
      controller.cancel()
      // A pending approval/question prompt belongs to the cancelled turn;
      // dismiss it so the prompt loop cannot hang.
      store.dismissPrompt()
    },
    onSuggest: (line, cursor) => {
      const agent = controller.live()
      return agent === undefined ? [] : suggestionsFor(ctx, agent, line, cursor)
    },
    onPickerSelect: (id) => {
      void adoptFromPicker(id, false).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error), exit)
      })
    },
    onPickerFork: (id) => {
      void adoptFromPicker(id, true).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error), exit)
      })
    },
    onPickerCancel: () => {
      store.setPicker(undefined)
      if (controller.live() === undefined) {
        void controller.start('').then(() => { refreshStatus() }).catch((error: unknown) => {
          fail(error instanceof Error ? error.message : String(error), exit)
        })
      }
    },
  }

  let instance: ReturnType<typeof mountApp>

  /** Suspend the Ink surface, run a raw-terminal credential flow, and remount. */
  async function suspendSurface(flow: () => Promise<void>): Promise<void> {
    instance.unmount()
    try {
      await flow()
    } catch (error) {
      store.push({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
    instance = mountApp(store, callbacks)
  }

  instance = mountApp(store, callbacks)

  try {
    if (config.resumePicker) {
      await openPicker()
      refreshStatus()
    } else {
      await controller.start(resumeSessionId)
      refreshStatus()
    }
    await quitPromise
  } finally {
    instance.unmount()
    internals.stdin.setRawMode?.(false)
    await controller.shutdown()
  }
  exit(0)
}

/**
 * Mount the terminal client. One-shot and interactive modes are selected by
 * whether `config.task` carries non-whitespace text.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated invocation config.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const oneShot = config.task.trim() !== '' || config.stdinTask
  void (oneShot ? runOneShot(ctx, config, exit) : runInteractive(ctx, config, exit))
    .catch((error: unknown) => { fail(error instanceof Error ? error.message : String(error), exit) })
}
