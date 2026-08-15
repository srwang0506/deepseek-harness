/** One-shot driving, durable aggregation, flushing, and exit mapping. */

import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, Config, internals } from '../src/index.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

function appendTurn(session: Session, turn: number, message: UserMessage, text: string | undefined, completed: boolean): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: completed ? { kind: 'completed' } : { kind: 'aborted', reason: { kind: 'user' } } })
}

interface Bench {
  ctx: Context
  run(
    config?: Partial<Config>,
    stdinText?: string,
    stdinTty?: boolean,
  ): Promise<{ code: number; out: string; err: string; order: string[] }>
}

async function bench(script: Script): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, { ...options.meta === undefined ? {} : { meta: options.meta } })
      let idle = Promise.resolve()
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
        status: 'idle',
        ctx: agentCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
          idle = Promise.resolve().then(() => script.afterPrompt(session, message))
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options.setup?.(agentCtx)
      script.before?.(session)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  return {
    ctx,
    run: async (config: Partial<Config> = {}, stdinText = '', stdinTty = false) => {
      let out = ''
      let err = ''
      const order: string[] = []
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const input = new PassThrough()
      Object.assign(input, { isTTY: stdinTty, setRawMode: () => {} })
      const fakeStdin = input as typeof internals.stdin
      internals.stdin = fakeStdin
      input.end(stdinText)
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx, {
        task: 'do the thing',
        resumeSessionId: '',
        continue: false,
        model: '',
        output: 'text',
        images: [],
        ephemeral: false,
        resumePicker: false,
        stdinTask: false,
        outputSchema: '',
        outputFile: '',
        ...config,
      })
      return { code: await exited, out, err, order }
    },
  }
}

describe('tui runner (one-shot)', () => {
  it('aggregates the final text and flushes before exit', async () => {
    const test = await bench({
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result).toEqual({ code: 0, out: 'final answer\n', err: '', order: ['flush', 'flush', 'exit'] })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'SERVER', message: 'down' } } })
      },
    })
    expect(await test.run()).toMatchObject({ code: 1, err: 'dsh: SERVER: down\n' })
    await test.ctx.fiber.dispose()
  })

  it('streams a versioned JSONL envelope: init, events, and result', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })
    const result = await test.run({ output: 'jsonl' })
    const lines = result.out.trim().split('\n').map((line): unknown => JSON.parse(line))
    expect(lines[0]).toMatchObject({ v: 1, type: 'init', provider: 'test-provider', model: 'test-model' })
    const middleLinesValid = lines.slice(1, -1).every((line) => {
      const record = line as { v?: unknown; type?: unknown }
      return record.v === 1 && record.type !== undefined
    })
    expect(middleLinesValid).toBe(true)
    expect(lines.at(-1)).toMatchObject({ v: 1, type: 'result', ok: true, turnReason: 'completed' })
    expect(result.code).toBe(0)
    await test.ctx.fiber.dispose()
  })

  it('reads the task from piped stdin with --stdin-task', async () => {
    const test = await bench({
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, 'echoed', true)
      },
    })
    const result = await test.run({ task: '', stdinTask: true }, 'piped prompt\n')
    expect(result.out).toBe('echoed\n')
    expect(result.code).toBe(0)
    await test.ctx.fiber.dispose()
  })

  it('rejects --stdin-task on a terminal with a usage error', async () => {
    const test = await bench({ afterPrompt: () => {} })
    const result = await test.run({ task: '', stdinTask: true, outputFile: '' }, '', true)
    expect(result.code).toBe(1)
    expect(result.err).toContain('stdin is a terminal')
    await test.ctx.fiber.dispose()
  })

  it('validates the final output against --output-schema and prints the parsed JSON', async () => {
    const test = await bench({
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '{"ok":true,"count":3}', true)
      },
    })
    const schema = '{"type":"object","required":["ok","count"],"properties":{"ok":{"type":"boolean"},"count":{"type":"integer"}}}'
    const result = await test.run({ outputSchema: schema })
    expect(result.code).toBe(0)
    expect(result.out).toBe('{"ok":true,"count":3}\n')
    await test.ctx.fiber.dispose()
  })

  it('exits 2 when the final output fails the requested schema', async () => {
    const test = await bench({
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '{"count":"three"}', true)
      },
    })
    const schema = '{"type":"object","required":["count"],"properties":{"count":{"type":"integer"}}}'
    const result = await test.run({ outputSchema: schema })
    expect(result.code).toBe(2)
    expect(result.out).toBe('')
    expect(result.err).toContain('does not match the requested schema')
    await test.ctx.fiber.dispose()
  })

  it('writes the final output to the --output-file instead of stdout', async () => {
    const test = await bench({
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, 'file content', true)
      },
    })
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-out-'))
    const file = join(dir, 'result.txt')
    try {
      const result = await test.run({ outputFile: file })
      expect(result.code).toBe(0)
      expect(result.out).toBe('')
      expect(readFileSync(file, 'utf8')).toBe('file content\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    await test.ctx.fiber.dispose()
  })

  it('validates config defaults', () => {
    expect(new Config({ task: 'x', resumeSessionId: '', continue: false, model: '', output: 'text', images: [], ephemeral: false, resumePicker: false, stdinTask: false, outputSchema: '', outputFile: '' }))
      .toMatchObject({ task: 'x', resumeSessionId: '', continue: false, model: '', output: 'text', images: [], ephemeral: false, resumePicker: false, stdinTask: false, outputSchema: '', outputFile: '' })
  })
})
