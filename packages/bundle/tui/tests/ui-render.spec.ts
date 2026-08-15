/** Render + input smoke tests for the Ink components (no real TTY). */

import { createElement as h } from 'react'
import { cleanup, render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffView, MarkdownView } from '../src/ui/rich.tsx'
import { UiStore } from '../src/ui/store.ts'
import { App } from '../src/ui/app.tsx'
import type { AppCallbacks } from '../src/ui/app.tsx'

afterEach(() => { cleanup() })

function callbacks(overrides: Partial<AppCallbacks> = {}): AppCallbacks {
  return {
    onSubmit: () => {},
    onQuit: () => {},
    onCycleApproval: () => {},
    onTogglePlan: () => {},
    onComplete: () => undefined,
    onCancel: () => {},
    onSuggest: () => [],
    ...overrides,
  }
}

describe('MarkdownView', () => {
  it('renders bold, inline code, and lists', () => {
    const { lastFrame } = render(h(MarkdownView, { text: '**bold** and `code`\n- item' }))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('bold')
    expect(frame).toContain('code')
    expect(frame).toContain('item')
  })

  it('renders a fenced code block', () => {
    const { lastFrame } = render(h(MarkdownView, { text: '```ts\nconst x = 1\n```' }))
    expect(lastFrame() ?? '').toContain('const')
  })
})

describe('DiffView', () => {
  it('renders unified diff lines', () => {
    const { lastFrame } = render(h(DiffView, { text: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new' }))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('old')
    expect(frame).toContain('new')
  })
})

describe('App', () => {
  it('renders the status bar, conversation, and input line', () => {
    const store = new UiStore()
    store.setStatus('deepseek-official/deepseek-v4-flash')
    store.push({ kind: 'assistant', text: 'hello' })
    const { lastFrame } = render(h(App, { store, callbacks: callbacks() }))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('deepseek-v4-flash')
    expect(frame).toContain('hello')
  })

  it('shows suggestion rows above the input', () => {
    const store = new UiStore()
    const withSuggest = callbacks({ onSuggest: () => ['alpha.txt', 'beta.txt'] })
    const { stdin, lastFrame } = render(h(App, { store, callbacks: withSuggest }))
    stdin.write('@')
    expect(lastFrame() ?? '').toContain('alpha.txt')
  })
})
