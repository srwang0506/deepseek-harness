import { beforeEach, describe, expect, it } from 'vitest'
import { setColorEnabled } from '../src/theme.ts'
import { MarkdownStream, renderMarkdown } from '../src/markdown.ts'

beforeEach(() => { setColorEnabled(false) })

describe('renderMarkdown', () => {
  it('renders headings, lists, quotes, inline code, bold, and links', () => {
    const out = renderMarkdown('# Title\n- item\n> quote\n`code` and **bold** and [link](http://x)')
    expect(out).toContain('Title')
    expect(out).toContain('• item')
    expect(out).toContain('quote')
    expect(out).toContain('code')
    expect(out).toContain('bold')
    expect(out).toContain('link (http://x)')
  })

  it('passes fenced code through the highlighter', () => {
    const out = renderMarkdown('```ts\nconst x = 1\n```')
    expect(out).toContain('const x = 1')
  })

  it('tolerates an unterminated fence', () => {
    const out = renderMarkdown('```ts\nconst x = 1')
    expect(out).toContain('const x = 1')
  })
})

describe('MarkdownStream', () => {
  it('renders complete lines and flushes the trailing partial line', () => {
    const stream = new MarkdownStream()
    expect(stream.push('# Title\n')).toContain('Title')
    expect(stream.push('partial')).toBe('')
    expect(stream.flush()).toContain('partial')
  })

  it('renders a fenced code block as a unit when the fence closes', () => {
    const stream = new MarkdownStream()
    expect(stream.push('```ts\n')).toBe('')
    expect(stream.push('const x = 1\n')).toBe('')
    expect(stream.push('```\n')).toContain('const x = 1')
  })
})
