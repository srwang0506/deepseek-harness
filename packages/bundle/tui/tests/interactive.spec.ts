/** Event-to-store mapping for the full-screen UI. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayEventToStore, streamEventToStore } from '../src/index.ts'
import { UiStore } from '../src/ui/store.ts'

function ev(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data } as unknown as SessionEvent
}

describe('streamEventToStore', () => {
  it('appends text deltas into one assistant row', () => {
    const store = new UiStore()
    streamEventToStore(ev('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'hel' } }), store)
    streamEventToStore(ev('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'lo' } }), store)
    expect(store.getSnapshot().items).toEqual([{ key: 1, kind: 'assistant', text: 'hello' }])
  })

  it('pushes tool calls, results, and turn errors', () => {
    const store = new UiStore()
    streamEventToStore(ev('tool/call', { turn: 0, step: 0, callId: 'c', name: 'bash', arguments: '{"command":"ls"}' }), store)
    expect(store.getSnapshot().items[0]).toMatchObject({ kind: 'tool', text: 'ls' })

    const ended = new UiStore()
    streamEventToStore(ev('turn/end', { turn: 0, reason: { kind: 'error', error: { code: 'X', message: 'boom' } } }), ended)
    expect(ended.getSnapshot().items[0]).toEqual({ key: 1, kind: 'error', text: 'X: boom' })
  })
})

describe('replayEventToStore', () => {
  it('echoes user and assistant messages from a resumed transcript', () => {
    const store = new UiStore()
    replayEventToStore(ev('user/message', { role: 'user', id: 'u', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }), store)
    replayEventToStore(ev('assistant/message', { turn: 0, step: 0, message: { role: 'assistant', id: 'a', content: [{ type: 'text', text: 'hello' }], source: { kind: 'model', provider: 'p', model: 'm' } } }), store)
    expect(store.getSnapshot().items.map(item => [item.kind, item.text])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello'],
    ])
  })
})

import { extractSkillInvocations, promptApproval, promptQuestions, restoreSessionSelection } from '../src/index.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Drive a prompt flow: answer every prompt it opens with the same value until
 * the pending promise settles, so multi-question requests complete.
 */
function answerPrompt<T>(pending: Promise<T>, store: UiStore, value: string | null): Promise<T> {
  void (async () => {
    for (;;) {
      await Promise.resolve()
      const prompt = store.getSnapshot().prompt
      if (prompt === undefined) break
      prompt.answer(value)
      // A macro-task turn lets the question loop open its next prompt.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    }
  })()
  return pending
}

describe('extractSkillInvocations', () => {
  it('collects unique kebab-case names in first-appearance order', () => {
    expect(extractSkillInvocations('$demo-skill and $other-1, then $demo-skill again')).toEqual(['demo-skill', 'other-1'])
  })

  it('collects digit-bearing names and ignores empty tokens', () => {
    expect(extractSkillInvocations('costs $5 and $ not-a-skill')).toEqual(['5'])
  })
})

describe('restoreSessionSelection', () => {
  it('restores the last route and reasoning effort from the session log', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('session-restore'))
    session.append('request/context', { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 100 })
    session.append('request/header', {
      header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: ReasoningEffortId('high') } },
      reason: 'initial',
    })
    expect(restoreSessionSelection(session)).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('high'),
    })
    await ctx.fiber.dispose()
  })

  it('restores the route without an effort when the last header has none', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('session-restore-plain'))
    session.append('request/context', { provider: 'p', model: 'm', contextWindow: 200 })
    session.append('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' })
    expect(restoreSessionSelection(session)).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })

  it('returns undefined before the first request', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('session-fresh'))
    expect(restoreSessionSelection(session)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('promptApproval', () => {
  it('maps y to allowed-once, n to rejected, and a dismissal to cancelled', async () => {
    const allow = new UiStore()
    await expect(answerPrompt(promptApproval(allow, 'echo', undefined), allow, 'y')).resolves.toBe('allowed-once')
    expect(allow.getSnapshot().prompt).toBeUndefined()

    const reject = new UiStore()
    await expect(answerPrompt(promptApproval(reject, 'echo', undefined), reject, 'n')).resolves.toBe('rejected')
    expect(reject.getSnapshot().prompt).toBeUndefined()

    const dismiss = new UiStore()
    await expect(answerPrompt(promptApproval(dismiss, 'echo', 'unsafe'), dismiss, null)).resolves.toBe('cancelled')
    expect(dismiss.getSnapshot().prompt).toBeUndefined()
  })
})

describe('promptQuestions', () => {
  it('selects a preset option by number', async () => {
    const store = new UiStore()
    const pending = promptQuestions(store, [
      { id: 'pick', question: 'Pick one', options: [{ label: 'alpha' }, { label: 'beta' }] },
    ])
    await expect(answerPrompt(pending, store, '2')).resolves.toEqual({
      answers: [{ id: 'pick', selected: ['beta'] }],
    })
  })

  it('accepts a typed custom answer instead of a preset', async () => {
    const store = new UiStore()
    const pending = promptQuestions(store, [
      { id: 'pick', question: 'Pick one', options: [{ label: 'alpha' }, { label: 'beta' }] },
    ])
    await expect(answerPrompt(pending, store, 'something else')).resolves.toEqual({
      answers: [{ id: 'pick', selected: [], custom: 'something else' }],
    })
  })

  it('combines preset numbers with typed text for multi-select', async () => {
    const store = new UiStore()
    const pending = promptQuestions(store, [
      { id: 'many', question: 'Pick several', multiSelect: true, options: [{ label: 'alpha' }, { label: 'beta' }, { label: 'gamma' }] },
    ])
    await expect(answerPrompt(pending, store, '1, 3 keep the blue one')).resolves.toEqual({
      answers: [{ id: 'many', selected: ['alpha', 'gamma'], custom: 'keep the blue one' }],
    })
  })

  it('takes multi-line free text for option-free questions', async () => {
    const store = new UiStore()
    const pending = promptQuestions(store, [
      { id: 'free', question: 'Describe it' },
    ])
    await expect(answerPrompt(pending, store, 'first line\nsecond line')).resolves.toEqual({
      answers: [{ id: 'free', selected: [], custom: 'first line\nsecond line' }],
    })
  })

  it('records an empty answer as no selection when the prompt is dismissed', async () => {
    const store = new UiStore()
    const pending = promptQuestions(store, [
      { id: 'pick', question: 'Pick one', options: [{ label: 'alpha' }] },
      { id: 'free', question: 'Describe it' },
    ])
    await expect(answerPrompt(pending, store, null)).resolves.toEqual({
      answers: [{ id: 'pick', selected: [] }, { id: 'free', selected: [] }],
    })
  })
})
