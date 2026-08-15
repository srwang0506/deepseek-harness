/** TerminalSessionController: adoption, submission/steering, cancel, routing, shutdown. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { TerminalSessionController } from '../src/controller.ts'
import type { TerminalSessionCallbacks } from '../src/controller.ts'

interface FakeRecord {
  agent: Agent
  session: Session
  followups: UserMessage[]
  steers: UserMessage[]
  injects: UserMessage[]
  cancels: unknown[]
  disposed: boolean
  setStatus(status: 'idle' | 'running'): void
  settle(): void
}

interface Harness {
  ctx: Context
  records: FakeRecord[]
  running: boolean[]
  events: Array<{ session: Session; type: string }>
  controller: TerminalSessionController
  /** Create one extra registered root agent through the fake factory. */
  spawn(): Promise<Agent>
}

const message = (text: string): UserMessage => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

async function harness(
  callbacks: Partial<TerminalSessionCallbacks> = {},
  services: { approval?: boolean; questions?: boolean } = {},
  selection: ModelSelectionRef = { current: { provider: 'test-provider', model: 'test-model' }, assembled: undefined },
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  if (services.approval !== false) await ctx.plugin(ApprovalService)
  if (services.questions === true) await ctx.plugin(UserQuestionService)
  const records: FakeRecord[] = []
  const events: Array<{ session: Session; type: string }> = []
  const running: boolean[] = []

  const makeFake = (ownerCtx: Context, options: CreateAgentOptions, sessionId: SessionId): AgentHandle => {
    const session = ctx.sessions.create(sessionId, { ...(options.meta === undefined ? {} : { meta: options.meta }) })
    let idle: Promise<void> = Promise.resolve()
    let release: (() => void) | undefined
    const record: FakeRecord = {
      agent: undefined as unknown as Agent,
      session,
      followups: [],
      steers: [],
      injects: [],
      cancels: [],
      disposed: false,
      setStatus: (status) => {
        Object.assign(record.agent, { status })
        if (status === 'running') {
          idle = new Promise<void>((resolve) => { release = resolve })
        }
      },
      settle: () => {
        release?.()
        release = undefined
        idle = Promise.resolve()
        Object.assign(record.agent, { status: 'idle' })
      },
    }
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id: session.id,
      options: options.agentOptions ?? {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx: agentCtx,
      cancel: (cause: unknown) => {
        record.cancels.push(cause)
        record.settle()
      },
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (userMessage: UserMessage) => { record.followups.push(userMessage) },
      steer: (userMessage: UserMessage) => { record.steers.push(userMessage) },
      inject: (userMessage: UserMessage) => { record.injects.push(userMessage) },
      whenIdle: () => idle,
    } satisfies Partial<Agent>)
    void options.setup?.(agentCtx)
    record.agent = agent
    records.push(record)
    ctx.agents.register(agent)
    return { agent, dispose: async () => { record.disposed = true } }
  }

  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      return makeFake(ownerCtx, options, SessionId(`session-${records.length}`))
    },
    async resume(ownerCtx: Context, options: CreateAgentOptions & { resumeSessionId: SessionId }): Promise<AgentHandle> {
      return makeFake(ownerCtx, options, options.resumeSessionId)
    },
  })

  const controller = new TerminalSessionController({
    ctx,
    selectionRef: selection,
    callbacks: {
      onEvent: (session, event) => { events.push({ session, type: event.type }) },
      askApproval: async (_toolName, reason) => (reason === undefined ? 'allowed-once' : 'rejected'),
      askQuestions: async questions => ({ answers: questions.map(q => ({ id: q.id, selected: [] })) }),
      onRunningChange: (isRunning) => { running.push(isRunning) },
      ...callbacks,
    },
  })
  return {
    ctx,
    records,
    running,
    events,
    controller,
    spawn: async () => {
      const handle = await ctx.agents.create({
        sessionId: SessionId(`session-extra-${records.length}`),
        agentOptions: {},
        setup: () => {},
      })
      return handle.agent
    },
  }
}

describe('TerminalSessionController', () => {
  it('queues a message while running and drains it as the next followup turn', async () => {
    const queueChanges: boolean[] = []
    const test = await harness({ onQueueChange: (queued) => { queueChanges.push(queued) } })
    await test.controller.start('')
    const record = test.records[0]
    record?.setStatus('running')
    test.controller.queue(message('next turn'))
    expect(queueChanges).toEqual([true])
    expect(record?.followups).toHaveLength(0)
    record?.settle()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(record?.followups.map(m => textOf(m))).toEqual(['next turn'])
    expect(queueChanges).toEqual([true, false])
    await test.ctx.fiber.dispose()
  })

  it('replaces a previously queued message and submits immediately while idle', async () => {
    const test = await harness()
    await test.controller.start('')
    const record = test.records[0]
    record?.setStatus('running')
    test.controller.queue(message('first queued'))
    test.controller.queue(message('second queued'))
    record?.settle()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(record?.followups.map(m => textOf(m))).toEqual(['second queued'])
    test.controller.queue(message('immediate'))
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(record?.followups.map(m => textOf(m))).toEqual(['second queued', 'immediate'])
    await test.ctx.fiber.dispose()
  })

  it('clears the queue when the agent is disposed', async () => {
    const queueChanges: boolean[] = []
    const test = await harness({ onQueueChange: (queued) => { queueChanges.push(queued) } })
    await test.controller.start('')
    const record = test.records[0]
    record?.setStatus('running')
    test.controller.queue(message('queued then replaced'))
    await test.controller.replace('')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(queueChanges).toEqual([true, false])
    await test.ctx.fiber.dispose()
  })

  it('drops a queue when no agent is adopted', async () => {
    const queueChanges: boolean[] = []
    const test = await harness({ onQueueChange: (queued) => { queueChanges.push(queued) } })
    test.controller.queue(message('nowhere'))
    expect(queueChanges).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('adopts a fresh agent and exposes it', async () => {
    const test = await harness()
    const agent = await test.controller.start('')
    expect(test.controller.live()).toBe(agent)
    expect(test.controller.isRunning()).toBe(false)
    await test.controller.shutdown()
    expect(test.controller.live()).toBeUndefined()
    expect(test.records[0]?.disposed).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('submits followup turns while idle and steering while running', async () => {
    const test = await harness()
    await test.controller.start('')
    await test.controller.submit(message('first'))
    expect(test.records[0]?.followups.map(m => textOf(m))).toEqual(['first'])
    expect(test.records[0]?.steers).toHaveLength(0)
    expect(test.running).toEqual([true, false])

    test.records[0]?.setStatus('running')
    const pending = test.controller.submit(message('mid-run'))
    await Promise.resolve()
    expect(test.records[0]?.steers.map(m => textOf(m))).toEqual(['mid-run'])
    test.records[0]?.settle()
    await pending
    expect(test.running).toEqual([true, false, true, false])
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('cancels the live turn with the user cause and injects context without waking', async () => {
    const test = await harness()
    await test.controller.start('')
    test.controller.cancel()
    test.controller.inject(message('context'))
    expect(test.records[0]?.cancels).toEqual([{ kind: 'user' }])
    expect(test.records[0]?.injects.map(m => textOf(m))).toEqual(['context'])
    expect(test.records[0]?.followups).toHaveLength(0)
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('routes root and subagent events to the surface and drops foreign ones', async () => {
    const test = await harness()
    const early = test.ctx.sessions.create(SessionId('session-early'))
    early.append('turn/start', { turn: 1 })
    expect(test.events).toEqual([])

    const agent = await test.controller.start('')
    agent.session.append('turn/start', { turn: 1 })
    expect(test.events.map(e => e.type)).toEqual(['turn/start'])

    const foreign = test.ctx.sessions.create(SessionId('session-foreign'))
    foreign.append('turn/start', { turn: 1 })
    expect(test.events.map(e => e.type)).toEqual(['turn/start'])

    const sub = test.ctx.sessions.create(SessionId('session-sub'), { meta: { parentSession: agent.id } })
    sub.append('turn/start', { turn: 1 })
    expect(test.events.map(e => [e.session.id, e.type])).toEqual([
      [agent.id, 'turn/start'],
      [sub.id, 'turn/start'],
    ])

    const orphan = test.ctx.sessions.create(SessionId('session-orphan'), { meta: { parentSession: SessionId('session-gone') } })
    orphan.append('turn/start', { turn: 1 })
    expect(test.events.map(e => e.session.id)).toEqual([agent.id, sub.id])

    await test.controller.shutdown()
    const before = test.events.length
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(test.events.length).toBe(before)
    await test.ctx.fiber.dispose()
  })

  it('answers approvals for the live agent only and delegates foreign requests', async () => {
    const test = await harness()
    const agent = await test.controller.start('')
    seedTurn(agent.session)
    const request: ApprovalRequest = { agent, toolName: 'echo' }
    await expect(test.ctx.approval.request(request)).resolves.toBe('allowed-once')

    const foreignSession = test.ctx.sessions.create(SessionId('session-foreign'))
    seedTurn(foreignSession)
    const foreign = { session: foreignSession } as unknown as Agent
    const foreignRequest: ApprovalRequest = { agent: foreign, toolName: 'echo' }
    await expect(test.ctx.approval.request(foreignRequest)).resolves.toBe('unavailable')
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('replaces the live agent with a resumed session and replays via onAdopt', async () => {
    const adoptions: Array<{ id: string; resumed: boolean }> = []
    const test = await harness({
      onAdopt: (adopted, resumed) => { adoptions.push({ id: adopted.id, resumed }) },
    })
    await test.controller.start('')
    await test.controller.replace('session-persisted')
    expect(test.records[0]?.disposed).toBe(true)
    expect(test.controller.live()).toBe(test.records[1]?.agent)
    expect(adoptions).toEqual([
      { id: test.records[0]?.session.id, resumed: false },
      { id: 'session-persisted', resumed: true },
    ])
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('fails loud at construction without the sessions registry', () => {
    const ctx = new Context()
    expect(() => new TerminalSessionController({
      ctx,
      selectionRef: { current: { provider: 'p', model: 'm' }, assembled: undefined },
      callbacks: {
        onEvent: () => {},
        askApproval: async () => 'rejected',
        askQuestions: async () => ({ answers: [] }),
      },
    })).toThrow(/sessions registry is not mounted/)
  })

  it('works without an approval service mounted', async () => {
    const test = await harness({}, { approval: false })
    await test.controller.start('')
    await test.controller.submit(message('first'))
    expect(test.records[0]?.followups).toHaveLength(1)
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('fails a mid-flight aborted approval closed without prompting', async () => {
    const test = await harness()
    const agent = await test.controller.start('')
    seedTurn(agent.session)
    const aborted = new AbortController()
    aborted.abort()
    const request: ApprovalRequest = { agent, toolName: 'echo', signal: aborted.signal }
    await expect(
      test.ctx.waterfall('approval/request', request, () => Promise.resolve<ApprovalOutcome>('unavailable')),
    ).resolves.toBe('cancelled')
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('answers questions for the live root and rejects foreign agents', async () => {
    const test = await harness({}, { questions: true })
    const agent = await test.controller.start('')
    await expect(test.ctx.userQuestions.ask({ agent, questions: [{ id: 'q', question: 'Pick' }] }))
      .resolves.toEqual({ answers: [{ id: 'q', selected: [] }] })
    const foreign = await test.spawn()
    await expect(test.ctx.userQuestions.ask({ agent: foreign, questions: [{ id: 'q', question: 'Pick' }] }))
      .rejects.toThrow('terminal user interaction requires the live terminal agent')
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('ignores submission, settle, and flush before adoption', async () => {
    const test = await harness()
    await test.controller.submit(message('early'))
    await test.controller.settle()
    await test.controller.flush()
    expect(test.records).toHaveLength(0)
    await test.controller.shutdown()
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('does not re-fire the running indicator for overlapping submissions', async () => {
    const test = await harness()
    await test.controller.start('')
    test.records[0]?.setStatus('running')
    const first = test.controller.submit(message('a'))
    const second = test.controller.submit(message('b'))
    test.records[0]?.settle()
    await first
    await second
    expect(test.records[0]?.steers).toHaveLength(2)
    expect(test.running).toEqual([true, false])
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('fails loud on start without the agents registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const controller = new TerminalSessionController({
      ctx,
      selectionRef: { current: { provider: 'p', model: 'm' }, assembled: undefined },
      callbacks: {
        onEvent: () => {},
        askApproval: async () => 'rejected',
        askQuestions: async () => ({ answers: [] }),
      },
    })
    await expect(controller.start('')).rejects.toThrow(/agents registry is not mounted/)
    await ctx.fiber.dispose()
  })

  it('fails loud on start without a model selection', async () => {
    const test = await harness({}, {}, { current: undefined, assembled: undefined })
    await expect(test.controller.start('')).rejects.toThrow(/no model selection/)
    await test.ctx.fiber.dispose()
  })

  it('settle waits for quiescence and flushes without waking the agent', async () => {
    const test = await harness()
    await test.controller.start('')
    test.records[0]?.setStatus('running')
    const pending = test.controller.settle()
    test.records[0]?.settle()
    await pending
    expect(test.running).toEqual([true, false])
    await test.controller.shutdown()
    await test.ctx.fiber.dispose()
  })

  it('shutdown cancels a running turn and flushes before disposal', async () => {
    const test = await harness()
    await test.controller.start('')
    test.records[0]?.setStatus('running')
    const flushed: string[] = []
    test.ctx.on('session/flush', (session) => { flushed.push(session.id) })
    await test.controller.shutdown()
    expect(test.records[0]?.cancels).toEqual([{ kind: 'user' }])
    expect(test.records[0]?.disposed).toBe(true)
    expect(flushed).toEqual([test.records[0]?.session.id])
    await test.ctx.fiber.dispose()
  })
})

/** Open a turn so approval requests satisfy their turn-enclosure precondition. */
function seedTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'seed' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Join the visible text blocks of a message. */
function textOf(content: UserMessage): string {
  return content.content.filter(block => block.type === 'text').map(block => block.text).join('')
}
