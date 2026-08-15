/** Overlay key handling: search typing, selection, insertion, and closing. */

import { describe, expect, it } from 'vitest'
import { openHistoryOverlay, overlayKey } from '../src/ui/overlay.ts'
import type { UiOverlay } from '../src/ui/store.ts'
import type { KeyLike } from '../src/ui/keys.ts'

function key(overrides: Partial<KeyLike> = {}): KeyLike {
  return {
    return: false, escape: false, ctrl: false, shift: false, tab: false,
    backspace: false, delete: false, meta: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    ...overrides,
  }
}

const history = ['fix the bug', 'run the tests', 'answer the question']

describe('openHistoryOverlay', () => {
  it('ranks the newest submitted line first and skips an empty history', () => {
    const overlay = openHistoryOverlay(history)
    expect(overlay).toEqual({
      kind: 'history',
      query: '',
      matches: ['answer the question', 'run the tests', 'fix the bug'],
      selected: 0,
    })
    expect(openHistoryOverlay([])).toBeUndefined()
  })
})

describe('overlayKey', () => {
  const open: UiOverlay = openHistoryOverlay(history)!

  it('filters matches as the query grows and resets the selection', () => {
    const typed = overlayKey(open, 'the', key(), history) as UiOverlay
    expect(typed.query).toBe('the')
    expect(typed.matches).toEqual(['fix the bug', 'run the tests', 'answer the question'])
    expect(typed.selected).toBe(0)
  })

  it('backs one character out of the query', () => {
    const typed = overlayKey(open, 'th', key(), history) as UiOverlay
    const backed = overlayKey(typed, '', key({ backspace: true }), history) as UiOverlay
    expect(backed.query).toBe('t')
  })

  it('moves the selection with the arrows, wrapping at the edges', () => {
    const down = overlayKey(open, '', key({ downArrow: true }), history) as UiOverlay
    expect(down.selected).toBe(1)
    const up = overlayKey(open, '', key({ upArrow: true }), history) as UiOverlay
    expect(up.selected).toBe(2)
    const empty: UiOverlay = { kind: 'history', query: 'zz', matches: [], selected: 0 }
    expect(overlayKey(empty, '', key({ downArrow: true }), history)).toEqual(empty)
    expect(overlayKey(empty, '', key({ upArrow: true }), history)).toEqual(empty)
  })

  it('inserts the selected match on Enter and closes on Esc or Ctrl+C', () => {
    expect(overlayKey(open, '\r', key(), history)).toEqual({ insert: 'answer the question' })
    expect(overlayKey(open, '', key({ escape: true }), history)).toBeUndefined()
    expect(overlayKey(open, 'c', key({ ctrl: true }), history)).toBeUndefined()
    const none: UiOverlay = { kind: 'history', query: 'zz', matches: [], selected: 0 }
    expect(overlayKey(none, '\r', key(), history)).toBeUndefined()
  })

  it('ignores unrelated named keys', () => {
    expect(overlayKey(open, '', key(), history)).toEqual(open)
  })
})
