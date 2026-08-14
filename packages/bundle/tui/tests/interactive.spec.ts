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
