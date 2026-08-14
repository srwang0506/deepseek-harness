import { describe, expect, it } from 'vitest'
import { extractText, toolCallTitle, truncate } from '../src/present.ts'

describe('toolCallTitle', () => {
  it('shows the shell command', () => {
    expect(toolCallTitle('bash', '{"command":"ls -la"}')).toBe('ls -la')
  })

  it('shows the file path for file tools', () => {
    expect(toolCallTitle('write', '{"file_path":"a.txt","content":"x"}')).toBe('write a.txt')
    expect(toolCallTitle('str_replace_editor', '{"path":"a.txt"}')).toBe('str_replace_editor a.txt')
  })

  it('shows the query for search tools', () => {
    expect(toolCallTitle('web_search', '{"query":"deepseek"}')).toBe('web_search deepseek')
  })

  it('falls back to the raw arguments for unknown tools', () => {
    expect(toolCallTitle('mystery', '{"a":1}')).toBe('mystery {"a":1}')
  })
})

describe('extractText', () => {
  it('joins text blocks and recurses into tool results', () => {
    const text = extractText([
      { type: 'text', text: 'a' },
      { type: 'tool-result', toolCallId: 'c' as never, content: [{ type: 'text', text: 'b' }] },
    ])
    expect(text).toBe('ab')
  })
})

describe('truncate', () => {
  it('keeps short text and cuts long text with an ellipsis', () => {
    expect(truncate('abc', 10)).toBe('abc')
    expect(truncate('abcdefghij', 5)).toBe('abcde…')
  })
})
