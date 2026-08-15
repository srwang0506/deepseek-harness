import { describe, expect, it } from 'vitest'
import { UiStore } from '../src/ui/store.ts'

describe('UiStore', () => {
  it('publishes snapshots and notifies subscribers', () => {
    const store = new UiStore()
    const seen: number[] = []
    store.subscribe(() => { seen.push(store.getSnapshot().items.length) })
    store.push({ kind: 'user', text: 'hello' })
    store.appendText('assistant', 'hi')
    store.appendText('assistant', ' there')
    expect(store.getSnapshot().items).toEqual([
      { key: 1, kind: 'user', text: 'hello' },
      { key: 2, kind: 'assistant', text: 'hi there' },
    ])
    expect(seen).toEqual([1, 2, 2])
  })

  it('appends text to the last row of a kind, and starts a new row otherwise', () => {
    const store = new UiStore()
    store.appendText('assistant', 'a')
    store.push({ kind: 'tool', text: 'bash' })
    store.appendText('assistant', 'b')
    const items = store.getSnapshot().items
    expect(items.map(item => item.kind)).toEqual(['assistant', 'tool', 'assistant'])
    expect(items[0]?.text).toBe('a')
    expect(items[2]?.text).toBe('b')
  })

  it('holds a pending prompt and clears it', () => {
    const store = new UiStore()
    store.setPrompt({ kind: 'choice', question: 'Allow?', choices: ['y', 'n'], answer: () => {} })
    expect(store.getSnapshot().prompt?.question).toBe('Allow?')
    store.setPrompt(undefined)
    expect(store.getSnapshot().prompt).toBeUndefined()
  })

  it('setStatus publishes the status bar halves', () => {
    const store = new UiStore()
    store.setStatus({ left: 'sandbox read-only · 42 tokens', right: 'p/m' })
    expect(store.getSnapshot().status).toEqual({ left: 'sandbox read-only · 42 tokens', right: 'p/m' })
  })

  it('setRunning publishes the running flag', () => {
    const store = new UiStore()
    store.setRunning(true)
    expect(store.getSnapshot().running).toBe(true)
    store.setRunning(false)
    expect(store.getSnapshot().running).toBe(false)
  })

  it('dismissPrompt clears a pending prompt, answers null, and tolerates none pending', () => {
    const store = new UiStore()
    let answered: string | null | undefined
    store.setPrompt({ kind: 'text', question: 'Which?', choices: [], multiLine: false, answer: (value) => { answered = value } })
    store.dismissPrompt()
    expect(store.getSnapshot().prompt).toBeUndefined()
    expect(answered).toBeNull()
    store.dismissPrompt()
  })

  it('holds a session picker snapshot and clears it', () => {
    const store = new UiStore()
    const items = [{ id: 's1', title: 'First', cwd: '/tmp/a', createdAt: 1, live: false }]
    store.setPicker({ items, selected: 0 })
    expect(store.getSnapshot().picker).toEqual({ items, selected: 0 })
    store.setPicker(undefined)
    expect(store.getSnapshot().picker).toBeUndefined()
  })

  it('unsubscribes listeners', () => {
    const store = new UiStore()
    const seen: number[] = []
    const off = store.subscribe(() => { seen.push(1) })
    off()
    store.push({ kind: 'info', text: 'x' })
    expect(seen).toEqual([])
  })
})
