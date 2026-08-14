import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setColorEnabled } from '../src/theme.ts'
import { renderAssistantText, renderEvent, renderToolCall, renderUserMessage } from '../src/render.ts'

beforeEach(() => { setColorEnabled(false) })

/** Build a bare session event over an unchecked payload. */
function ev(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data } as unknown as SessionEvent
}

describe('render primitives', () => {
  it('renders user prompts and assistant markdown', () => {
    expect(renderUserMessage('hi')).toBe('› hi')
    expect(renderAssistantText('**bold**')).toBe('bold')
  })

  it('renders a tool call header', () => {
    expect(renderToolCall('bash', '{"command":"ls"}')).toContain('ls')
  })
})

describe('renderEvent', () => {
  it('streams text-delta chunks in live mode and skips them in replay', () => {
    const chunk = ev('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'hi' } })
    expect(renderEvent(chunk, {})).toBe('hi')
    expect(renderEvent(chunk, { replay: true })).toBeUndefined()
  })

  it('echoes user messages only in replay mode', () => {
    const user = ev('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }))
    expect(renderEvent(user, {})).toBeUndefined()
    expect(renderEvent(user, { replay: true })).toBe('› hello')
  })

  it('renders completed turns with no status line', () => {
    expect(renderEvent(ev('turn/end', { turn: 0, reason: { kind: 'completed' } }))).toBeUndefined()
  })
})
