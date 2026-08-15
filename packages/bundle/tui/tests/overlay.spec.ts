/** Overlay key handling: search typing, selection, insertion, and closing. */

import { describe, expect, it } from 'vitest'
import { historyRank, openFilesOverlay, openHistoryOverlay, overlayKey } from '../src/ui/overlay.ts'
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

describe('openFilesOverlay', () => {
  it('opens with the ranked matches and tolerates an empty result', () => {
    const rank = (query: string): string[] => query === '' ? ['src/index.ts', 'README.md'] : ['README.md']
    expect(openFilesOverlay(rank)).toEqual({ kind: 'files', query: '', matches: ['src/index.ts', 'README.md'], selected: 0 })
    expect(openFilesOverlay(rank, 'read')).toEqual({ kind: 'files', query: 'read', matches: ['README.md'], selected: 0 })
    expect(openFilesOverlay(() => [], 'zz')).toEqual({ kind: 'files', query: 'zz', matches: [], selected: 0 })
  })
})

describe('overlayKey', () => {
  const open: UiOverlay = openHistoryOverlay(history)!

  it('filters matches as the query grows and resets the selection', () => {
    const typed = overlayKey(open, 'the', key(), historyRank(history)) as UiOverlay
    expect(typed.query).toBe('the')
    expect(typed.matches).toEqual(['run the tests', 'fix the bug', 'answer the question'])
    expect(typed.selected).toBe(0)
  })

  it('backs one character out of the query', () => {
    const typed = overlayKey(open, 'th', key(), historyRank(history)) as UiOverlay
    const backed = overlayKey(typed, '', key({ backspace: true }), historyRank(history)) as UiOverlay
    expect(backed.query).toBe('t')
  })

  it('moves the selection with the arrows, wrapping at the edges', () => {
    const down = overlayKey(open, '', key({ downArrow: true }), historyRank(history)) as UiOverlay
    expect(down.selected).toBe(1)
    const up = overlayKey(open, '', key({ upArrow: true }), historyRank(history)) as UiOverlay
    expect(up.selected).toBe(2)
    const empty: UiOverlay = { kind: 'history', query: 'zz', matches: [], selected: 0 }
    expect(overlayKey(empty, '', key({ downArrow: true }), historyRank(history))).toEqual(empty)
    expect(overlayKey(empty, '', key({ upArrow: true }), historyRank(history))).toEqual(empty)
  })

  it('inserts the selected match on Enter and closes on Esc or Ctrl+C', () => {
    expect(overlayKey(open, '\r', key(), historyRank(history))).toEqual({ insert: 'answer the question' })
    expect(overlayKey(open, '', key({ escape: true }), historyRank(history))).toBeUndefined()
    expect(overlayKey(open, 'c', key({ ctrl: true }), historyRank(history))).toBeUndefined()
    const none: UiOverlay = { kind: 'history', query: 'zz', matches: [], selected: 0 }
    expect(overlayKey(none, '\r', key(), historyRank(history))).toBeUndefined()
  })

  it('ignores unrelated named keys', () => {
    expect(overlayKey(open, '', key(), historyRank(history))).toEqual(open)
  })
})
