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
    store.setPrompt({ question: 'Allow?', choices: ['y', 'n'], answer: () => {} })
    expect(store.getSnapshot().prompt?.question).toBe('Allow?')
    store.setPrompt(undefined)
    expect(store.getSnapshot().prompt).toBeUndefined()
  })
})
