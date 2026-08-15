/** Session-picker data: listing with folded titles and fork-by-id. */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-query'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { forkSessionById, pickerSessions } from '../src/index.ts'

/** A minimal SessionHeader for picker rows. */
function headerOf(id: string, createdAt: number, origin?: 'subagent', cwd?: string): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt, ...(origin === undefined ? {} : { origin }), ...(cwd === undefined ? {} : { cwd }) }
}

/** A SessionTitleSnapshot-shaped title for the query stub. */
function titleOf(text: string): SessionTitleSnapshot {
  return { title: text, messageSeqs: [], source: { kind: 'fallback' }, eventSeq: 1, updatedAt: 1 }
}

interface QueryStub {
  listSessions(): Promise<Array<{ header: SessionHeader; live: boolean; persisted: boolean }>>
  readTitleSnapshots(ids: readonly SessionId[]): Promise<Array<{ status: 'fulfilled'; value: { session: SessionHeader; title?: SessionTitleSnapshot } }>>
}

async function mountQuery(ctx: Context, headers: SessionHeader[]): Promise<void> {
  const byId = new Map(headers.map(header => [header.id, header]))
  const stub: QueryStub = {
    async listSessions() {
      return headers.map(header => ({ header, live: false, persisted: true }))
    },
    async readTitleSnapshots(ids) {
      return ids.map((id) => {
        const session = byId.get(id) ?? headerOf('missing', 0)
        const value = id.startsWith('session-untitled')
          ? { session }
          : { session, title: titleOf(`T-${id}`) }
        return { status: 'fulfilled' as const, value }
      })
    },
  }
  ctx.provide('sessionQuery' as never, stub as never)
}

describe('pickerSessions', () => {
  it('lists nothing with no services mounted', async () => {
    const ctx = new Context()
    await expect(pickerSessions(ctx)).resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('folds titles, filters subagents, and sorts newest first', async () => {
    const ctx = new Context()
    const headers = [
      headerOf('session-untitled', 200, undefined, '/tmp/a'),
      headerOf('session-old', 100, undefined, '/tmp/b'),
      headerOf('session-new', 300, undefined, '/tmp/c'),
      headerOf('session-sub', 400, 'subagent'),
    ]
    await mountQuery(ctx, headers)
    await expect(pickerSessions(ctx)).resolves.toEqual([
      { id: 'session-new', title: 'T-session-new', cwd: '/tmp/c', createdAt: 300, live: false },
      { id: 'session-untitled', title: undefined, cwd: '/tmp/a', createdAt: 200, live: false },
      { id: 'session-old', title: 'T-session-old', cwd: '/tmp/b', createdAt: 100, live: false },
    ])
    await ctx.fiber.dispose()
  })

  it('falls back to persistence headers when no query service is mounted', async () => {
    const ctx = new Context()
    ctx.provide('sessionPersistence' as never, {
      async list() { return [headerOf('session-p', 50, undefined, '/tmp/p')] },
    } as never)
    await expect(pickerSessions(ctx)).resolves.toEqual([
      { id: 'session-p', title: undefined, cwd: '/tmp/p', createdAt: 50, live: false },
    ])
    await ctx.fiber.dispose()
  })
})

describe('forkSessionById', () => {
  interface Record {
    agent: Agent
    disposed: boolean
  }

  async function mountAgents(ctx: Context): Promise<Record[]> {
    const records: Record[] = []
    ctx.agents.setFactory({
      async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
        const session = ctx.sessions.create(options.sessionId, { ...(options.meta === undefined ? {} : { meta: options.meta }) })
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
          followup: () => {},
          steer: () => {},
          inject: () => {},
          whenIdle: () => Promise.resolve(),
        } satisfies Partial<Agent>)
        void options.setup?.(agentCtx)
        const record: Record = { agent, disposed: false }
        records.push(record)
        ctx.agents.register(agent)
        return { agent, dispose: async () => { record.disposed = true } }
      },
      async resume(ownerCtx: Context, options: CreateAgentOptions & { resumeSessionId: SessionId }): Promise<AgentHandle> {
        const base = ctx.sessions.get(options.resumeSessionId) ?? ctx.sessions.create(options.resumeSessionId, {})
        if (base.events.length === 0) base.append('turn/start', { turn: 0 })
        const agent = {} as Agent
        const agentCtx = ownerCtx.extend({ agent })
        Object.assign(agent, {
          id: base.id,
          options: options.agentOptions ?? {},
          session: base,
          inbox: new Inbox(base, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
          status: 'idle',
          ctx: agentCtx,
          cancel: () => {},
          runMaintenance: () => Promise.reject(new Error('not used')),
          send: () => {},
          followup: () => {},
          steer: () => {},
          inject: () => {},
          whenIdle: () => Promise.resolve(),
        } satisfies Partial<Agent>)
        void options.setup?.(agentCtx)
        const record: Record = { agent, disposed: false }
        records.push(record)
        ctx.agents.register(agent)
        return { agent, dispose: async () => { record.disposed = true } }
      },
    })
    return records
  }

  it('forks a live session through the persistence backend, honoring the boundary', async () => {
    const ctx = new Context()
    const root = mkdtempSync(join(tmpdir(), 'dsh-fork-live-'))
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root })
    const source = ctx.sessions.create(SessionId('session-live'), { meta: { cwd: '/tmp/x' } })
    source.append('turn/start', { turn: 0 })
    source.append('step/start', { turn: 0, step: 0 })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    source.append('step/end', { turn: 0, step: 0 })
    source.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    const childId = await forkSessionById(ctx, 'session-live', 2)
    // The child is never live: it resumes through the persistence path.
    expect(ctx.sessions.get(SessionId(childId))).toBeUndefined()
    const raw = await ctx.sessionPersistence.readRaw(SessionId(childId))
    expect(raw?.meta.parentSession).toBe(SessionId('session-live'))
    expect(raw?.meta.cwd).toBe('/tmp/x')
    expect(raw?.content).toContain('hello')
    // The boundary cuts the seed before the step/end and turn/end.
    expect(raw?.content).not.toContain('"step/end"')
    await ctx.fiber.dispose()
  })

  it('loads a persisted session, forks it, and disposes the loaded source', async () => {
    const ctx = new Context()
    const root = mkdtempSync(join(tmpdir(), 'dsh-fork-persisted-'))
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.plugin(JsonlSessionPersistence, { root })
    const records = await mountAgents(ctx)
    await ctx.sessionPersistence.create({ version: 0, id: SessionId('session-persisted'), createdAt: 1 })
    const childId = await forkSessionById(ctx, 'session-persisted')
    expect(childId).not.toBe('session-persisted')
    expect(records).toHaveLength(1)
    expect(records[0]?.disposed).toBe(true)
    const raw = await ctx.sessionPersistence.readRaw(SessionId(childId))
    expect(raw?.meta.parentSession).toBe(SessionId('session-persisted'))
    await ctx.fiber.dispose()
  })

  it('fails loud when session persistence is absent, and when the agents registry is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await expect(forkSessionById(ctx, 'session-persisted')).rejects.toThrow(/session persistence is not mounted/)
    await ctx.fiber.dispose()

    const other = new Context()
    const root = mkdtempSync(join(tmpdir(), 'dsh-fork-noagents-'))
    await other.plugin(SessionStore)
    await other.plugin(JsonlSessionPersistence, { root })
    await expect(forkSessionById(other, 'session-persisted')).rejects.toThrow(/agents registry is not mounted/)
    await other.fiber.dispose()
  })
})
