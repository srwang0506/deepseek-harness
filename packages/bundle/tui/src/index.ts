/**
 * @deepseek-ai/dsh-tui — the Codex-style terminal client. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins. One-shot mode (a
 * task positional) creates one Agent, drives it to quiescence, and prints the
 * final text; interactive mode mounts a full-screen Ink UI that streams
 * session events, answers approval/questions inline, and handles slash
 * commands.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { FileDiff } from '@deepseek-ai/dsh-tools/presentation'
import type { UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { loginOpenAi, logoutOpenAi, PiAiCredentialStore } from '@deepseek-ai/dsh-llm-pi-ai'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseSlash } from './slash.ts'
import { diffsFromMeta, plainFileDiffs } from './diff.ts'
import { extractText, toolCallTitle } from './present.ts'
import { completeMention, extractMentions, readMention, suggestMentions } from './mention.ts'
import { loadCustomCommands } from './custom-commands.ts'
import { UiStore } from './ui/store.ts'
import { mountApp } from './ui/app.tsx'
import type { AppCallbacks } from './ui/app.tsx'

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
}

export const Config: z<Config> = z.object({
  task: z.string().default(''),
  resumeSessionId: z.string().default(''),
  continue: z.boolean().default(false),
  model: z.string().default(''),
  output: z.union([z.const('text'), z.const('json'), z.const('jsonl')]).default('text'),
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

/** Options shared by one-shot and interactive agent creation. */
interface CreateOptions {
  resumeSessionId: string
  /** Mutable selection the agent reads at each step's prompt assembly. */
  selectionRef: ModelSelectionRef
}

/** Create or resume an agent through the core registry. */
async function createAgent(ctx: Context, options: CreateOptions): Promise<AgentHandle> {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error('tui-runner: the agents registry is not mounted')
  const selected = options.selectionRef.current
  if (selected === undefined) throw new Error('tui-runner: no model selection')
  const setup = (agentCtx: Context): void => {
    installModelSelection(agentCtx, options.selectionRef)
  }
  const agentOptions = { provider: selected.provider, model: selected.model }
  if (options.resumeSessionId !== '') {
    return agents.resume({ resumeSessionId: SessionId(options.resumeSessionId), agentOptions, setup })
  }
  return agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions,
    setup,
  })
}

/** Report an unexpected runner failure and request a failing exit. */
function fail(message: string, exit: (code: number) => void): void {
  internals.stderr.write(`dsh: ${message}\n`)
  exit(1)
}

/** One-shot mode: drive one task and print its final assistant text. */
async function runOneShot(ctx: Context, config: Config, exit: (code: number) => void): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return
  const selection = resolveSelection(defaultModel, config.model)
  const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined }
  const handle = await createAgent(ctx, { resumeSessionId: config.resumeSessionId, selectionRef })
  const { agent } = handle
  await agent.whenIdle()
  const firstSeq = agent.session.seq

  // JSONL mode streams every session event after submission as one JSON line.
  let disposeStream: (() => void) | undefined
  if (config.output === 'jsonl') {
    disposeStream = ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.seq < firstSeq) return
      internals.stdout.write(`${JSON.stringify({ type: event.type, data: event.data })}\n`)
    })
  }

  agent.followup(createUserMessage({
    content: [{ type: 'text', text: config.task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  const reason = outcome.reason
  if (config.output === 'json') {
    internals.stdout.write(`${JSON.stringify({
      ok: reason?.kind === 'completed',
      sessionId: agent.id,
      provider: selection.provider,
      model: selection.model,
      text: outcome.text,
      turnReason: reason?.kind ?? null,
      error: reason?.kind === 'error' ? { code: reason.error.code, message: reason.error.message } : null,
    })}\n`)
  } else if (config.output !== 'jsonl') {
    internals.stdout.write(outcome.text + '\n')
    if (reason?.kind === 'error') {
      internals.stderr.write(`dsh: ${reason.error.code}: ${reason.error.message}\n`)
    }
  }
  disposeStream?.()
  await handle.dispose()
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

/** Default AGENTS.md written by /init when none exists. */
const AGENTS_TEMPLATE = '# AGENTS.md\n\nInstructions for AI coding agents working in this repository.\n\nAdd project-specific conventions, commands, and guidelines here.\n'

/** The plain-text slash-command help. */
function helpText(): string {
  return [
    'Commands:',
    '  /new              start a fresh session',
    '  /resume [id]      list sessions, or resume the given id',
    '  /model [model]    show the model, or switch it',
    '  /login [method]   log into OpenAI GPT (browser, device, api-key)',
    '  /logout           remove the OpenAI GPT credential',
    '  /sessions         list persisted sessions',
    '  /status           show model, session, cwd, and login state',
    '  /compact          compact the session history',
    '  /init             write an AGENTS.md template',
    '  /doctor           check environment and credentials',
    '  /export [file]    export the session log as JSONL',
    '  /diff             show this session\'s file changes',
    '  /review           review this session\'s file changes for bugs',
    '  /undo             revert the most recent file change',
    '  /help             show this help',
    '  /quit             exit',
    'Keys: Shift+Tab cycles the permission preset; Ctrl+P toggles plan mode; Ctrl+C cancels the turn.',
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

/** Ask the user through the UI store, resolving with the chosen key or typed text. */
function askStore(store: UiStore, question: string, choices: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => { store.setPrompt({ question, choices, answer: resolve }) })
}

/** Prompt the user to allow or reject one approval. */
async function promptApproval(store: UiStore, toolName: string, reason: string | undefined): Promise<ApprovalOutcome> {
  const question = reason === undefined ? `Run ${toolName}? [y/N]` : `Run ${toolName} — ${reason}? [y/N]`
  const key = await askStore(store, question, ['y', 'n'])
  return key === 'y' ? 'allowed-once' : 'rejected'
}

/** Ask every question in one request, serially. */
async function promptQuestions(store: UiStore, questions: readonly AskUserQuestionItem[]): Promise<AskUserQuestionAnswer> {
  const answers: AskUserQuestionAnswer['answers'] = []
  for (const question of questions) {
    const options = question.options ?? []
    store.push({ kind: 'info', text: question.header === undefined ? question.question : `${question.header}: ${question.question}` })
    if (question.detail !== undefined) store.push({ kind: 'info', text: question.detail })
    if (options.length === 0) {
      const text = await askStore(store, `${question.question} `, [])
      answers.push({ id: question.id, selected: [], ...(text === null ? {} : { custom: text }) })
    } else if (question.multiSelect === true) {
      options.forEach((option, index) => { store.push({ kind: 'info', text: `  ${index + 1}. ${option.label}` }) })
      const line = await askStore(store, 'choose (comma-separated numbers): ', [])
      const indices = (line ?? '').split(/[,\s]+/).filter(token => /^\d+$/.test(token)).map(Number)
      const selected = indices
        .filter(index => index >= 1 && index <= options.length)
        .map(index => options[index - 1])
        .filter((option): option is (typeof options)[number] => option !== undefined)
        .map(option => option.label)
      answers.push({ id: question.id, selected })
    } else {
      options.forEach((option, index) => { store.push({ kind: 'info', text: `  ${index + 1}. ${option.label}` }) })
      const keys = options.map((_, index) => String(index + 1))
      const key = await askStore(store, `choose [${keys.join('/')}]`, keys)
      const index = key === null ? -1 : Number.parseInt(key, 10) - 1
      const chosen = index >= 0 && index < options.length ? options[index] : undefined
      answers.push({ id: question.id, selected: chosen === undefined ? [] : [chosen.label] })
    }
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
  const names = new Set(['new', 'resume', 'model', 'login', 'logout', 'sessions', 'status', 'compact', 'init', 'doctor', 'export', 'diff', 'review', 'undo', 'help', 'quit'])
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

  const current: { handle: AgentHandle | undefined; agent: Agent | undefined } = { handle: undefined, agent: undefined }
  const store = new UiStore()
  const promptQueue = makePromptQueue()

  // Approval answerer: only our own agent, fail closed on abort.
  if (ctx.get('approval') !== undefined) {
    ctx.on('approval/request', (req, next) => {
      if (req.agent !== current.agent) return next()
      if (req.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
      return promptQueue.run(() => promptApproval(store, req.toolName, req.reason))
    })
  }

  // User-questions provider: only our own live root.
  const questions = ctx.get('userQuestions')
  let disposeProvider: (() => void) | undefined
  if (questions !== undefined) {
    const provider: UserQuestionProvider = {
      ask(request): Promise<AskUserQuestionAnswer> {
        if (request.agent !== current.agent) {
          return Promise.reject(new Error('terminal user interaction requires the live terminal agent'))
        }
        return promptQueue.run(() => promptQuestions(store, request.questions))
      },
    }
    disposeProvider = questions.registerProvider(provider)
  }

  registerCustomCommands(ctx)

  // Live event stream, filtered to the current agent's session.
  const disposeStream = ctx.on('session/event', (session, event) => {
    if (current.agent === undefined || session !== current.agent.session) return
    streamEventToStore(event, store)
  })

  const refreshStatus = (): void => {
    if (current.agent !== undefined) store.setStatus(statusText(selection, ctx, current.agent))
  }

  const disposeCurrent = async (): Promise<void> => {
    await current.handle?.dispose()
    current.handle = undefined
    current.agent = undefined
  }

  const adopt = async (): Promise<Agent> => {
    const handle = await createAgent(ctx, { resumeSessionId, selectionRef })
    current.handle = handle
    current.agent = handle.agent
    await handle.agent.whenIdle()
    if (resumeSessionId !== '') {
      for (const event of handle.agent.session.events) replayEventToStore(event, store)
    }
    return handle.agent
  }

  let quitResolve: (() => void) | undefined
  const quitPromise = new Promise<void>((resolve) => { quitResolve = resolve })

  /** Handle one submitted line: a slash command, a mention, or a plain prompt. */
  const handleLine = async (line: string): Promise<void> => {
    const agent = current.agent
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
          await disposeCurrent()
          resumeSessionId = ''
          await adopt()
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
          for (const header of rows) {
            store.push({ kind: 'info', text: `${header.id}  ${new Date(header.createdAt).toLocaleString()}${header.cwd === undefined ? '' : `  ${header.cwd}`}` })
          }
          if (rows.length === 0) store.push({ kind: 'info', text: '(no persisted sessions)' })
          return
        }
        case 'resume': {
          const id = slash.args === '' ? await mostRecentSession(ctx) : slash.args
          if (id === '') {
            store.push({ kind: 'error', text: 'no session to resume' })
            return
          }
          await disposeCurrent()
          resumeSessionId = id
          await adopt()
          refreshStatus()
          store.push({ kind: 'info', text: `resumed session ${id}` })
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
          store.setRunning(true)
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' },
          }))
          await agent.whenIdle()
          await sessions.flush(agent.session)
          store.setRunning(false)
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
                await agent.whenIdle()
                await sessions.flush(agent.session)
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
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: `Content of ${mention.path}${suffix}:\n${mention.content}` }],
        source: { kind: 'plugin', plugin: 'tui-mention' },
      }))
    }
    store.push({ kind: 'user', text: line })
    store.setRunning(true)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: line }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await sessions.flush(agent.session)
    store.setRunning(false)
    refreshStatus()
  }

  const callbacks: AppCallbacks = {
    onSubmit: (line) => {
      void handleLine(line).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error), exit)
      })
    },
    onCycleApproval: () => { cyclePermissionPreset(ctx, current.agent, store); refreshStatus() },
    onTogglePlan: () => { togglePlanMode(ctx, current.agent, store); refreshStatus() },
    onComplete: (line, cursor) => completeMention(line, cursor, process.cwd()),
    onCancel: () => { current.agent?.cancel({ kind: 'user' }) },
    onSuggest: (line, cursor) => current.agent === undefined ? [] : suggestionsFor(ctx, current.agent, line, cursor),
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
    await adopt()
    refreshStatus()
    await quitPromise
  } finally {
    disposeStream()
    disposeProvider?.()
    instance.unmount()
    await disposeCurrent()
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
  const oneShot = config.task.trim() !== ''
  void (oneShot ? runOneShot(ctx, config, exit) : runInteractive(ctx, config, exit))
    .catch((error: unknown) => { fail(error instanceof Error ? error.message : String(error), exit) })
}
