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
    onPickerSelect: () => {},
    onPickerFork: () => {},
    onPickerCancel: () => {},
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
  it('renders the composer, conversation, and the two-sided status bar beneath it', () => {
    const store = new UiStore()
    store.setStatus({ left: 'sandbox read-only', right: 'deepseek-official/deepseek-v4-flash' })
    store.push({ kind: 'assistant', text: 'hello' })
    const { lastFrame } = render(h(App, { store, callbacks: callbacks() }))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('deepseek-v4-flash')
    expect(frame).toContain('sandbox read-only')
    expect(frame).toContain('hello')
    // Codex layout: the dim status bar sits below the conversation.
    expect(frame.indexOf('sandbox read-only')).toBeGreaterThan(frame.indexOf('hello'))
  })

  it('renders user and tool rows with the Codex marker', () => {
    const store = new UiStore()
    store.push({ kind: 'user', text: 'fix the bug' })
    store.push({ kind: 'tool', text: '[bash] ls' })
    const { lastFrame } = render(h(App, { store, callbacks: callbacks() }))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('⏺ fix the bug')
    expect(frame).toContain('⏺ [bash] ls')
  })

  it('shows the braille spinner in the status bar while running', () => {
    const store = new UiStore()
    store.setRunning(true)
    store.setStatus({ left: 'sandbox read-only', right: 'p/m' })
    const { lastFrame } = render(h(App, { store, callbacks: callbacks() }))
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/[⠋⠙⠸⠴⠦⠇]/)
  })

  it('renders typed input and the block cursor on the composer line', async () => {
    const store = new UiStore()
    const { stdin, lastFrame } = render(h(App, { store, callbacks: callbacks() }))
    // Ink attaches its stdin listener in a passive effect; give it a tick.
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('fix the bug')
    // A second printable input event flushes the complete frame: the testing
    // library's first post-write frame can paint spans progressively.
    stdin.write('!')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(lastFrame() ?? '').toContain('fix the bug!')
    expect(lastFrame() ?? '').toContain('█')
  })

  it('renders the session picker overlay with a highlighted row', () => {
    const store = new UiStore()
    store.setPicker({
      items: [
        { id: 'session-a', title: 'First session', cwd: '/tmp/a', createdAt: 42, live: false },
        { id: 'session-b', title: 'Second session', cwd: '/tmp/b', createdAt: 41, live: false },
      ],
      selected: 0,
    })
    const { lastFrame } = render(h(App, { store, callbacks: callbacks() }))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Resume session')
    expect(frame).toContain('First session')
    expect(frame).toContain('Second session')
  })

  it('moves the picker highlight with the arrow keys', async () => {
    const store = new UiStore()
    store.setPicker({
      items: [
        { id: 'session-a', title: 'First session', cwd: '/tmp/a', createdAt: 42, live: false },
        { id: 'session-b', title: 'Second session', cwd: '/tmp/b', createdAt: 41, live: false },
      ],
      selected: 0,
    })
    const { stdin } = render(h(App, { store, callbacks: callbacks() }))
    // Ink attaches its stdin listener in a passive effect; give it a tick.
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('\u001b[B')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(store.getSnapshot().picker?.selected).toBe(1)
    stdin.write('\u001b[B')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(store.getSnapshot().picker?.selected).toBe(0)
  })

  it('opens the history overlay with Ctrl+R, filters, and reuses a match', async () => {
    const store = new UiStore()
    const submitted: string[] = []
    const { stdin, lastFrame } = render(h(App, { store, callbacks: callbacks({ onSubmit: (line) => { submitted.push(line) } }) }) )
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('fix the bug\r')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('\x12')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('fix')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(lastFrame() ?? '').toContain('history search: fix')
    expect(lastFrame() ?? '').toContain('⏺ fix the bug')
    stdin.write('\r')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('\r')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(submitted).toEqual(['fix the bug', 'fix the bug'])
  })

  it('closes the history overlay with Esc', async () => {
    const store = new UiStore()
    const submitted: string[] = []
    const { stdin, lastFrame } = render(h(App, { store, callbacks: callbacks({ onSubmit: (line) => { submitted.push(line) } }) }) )
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('hello\r')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('\x12')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('\x1b')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stdin.write('x')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(lastFrame() ?? '').not.toContain('history search')
    expect(submitted).toEqual(['hello'])
  })

  it('shows suggestion rows above the input', () => {
    const store = new UiStore()
    const withSuggest = callbacks({ onSuggest: () => ['alpha.txt', 'beta.txt'] })
    const { stdin, lastFrame } = render(h(App, { store, callbacks: withSuggest }))
    stdin.write('@')
    expect(lastFrame() ?? '').toContain('alpha.txt')
  })
})
