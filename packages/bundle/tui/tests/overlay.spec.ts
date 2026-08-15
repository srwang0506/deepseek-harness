/** Overlay key handling: search typing, selection, insertion, and closing. */

import { describe, expect, it } from 'vitest'
import { editOverlayKey, historyRank, openEditOverlay, openFilesOverlay, openHistoryOverlay, overlayKey } from '../src/ui/overlay.ts'
import type { UiOverlay } from '../src/ui/store.ts'
import type { SearchOverlay } from '../src/ui/overlay.ts'
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
    const typed = overlayKey(open, 'the', key(), historyRank(history)) as SearchOverlay
    expect(typed.query).toBe('the')
    expect(typed.matches).toEqual(['run the tests', 'fix the bug', 'answer the question'])
    expect(typed.selected).toBe(0)
  })

  it('backs one character out of the query', () => {
    const typed = overlayKey(open, 'th', key(), historyRank(history)) as SearchOverlay
    const backed = overlayKey(typed, '', key({ backspace: true }), historyRank(history)) as SearchOverlay
    expect(backed.query).toBe('t')
  })

  it('moves the selection with the arrows, wrapping at the edges', () => {
    const down = overlayKey(open, '', key({ downArrow: true }), historyRank(history)) as SearchOverlay
    expect(down.selected).toBe(1)
    const up = overlayKey(open, '', key({ upArrow: true }), historyRank(history)) as SearchOverlay
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

describe('edit overlay', () => {
  const items = [
    { seq: 0, text: 'first message', forkBoundary: -1 },
    { seq: 2, text: 'second message', forkBoundary: 1 },
  ]

  it('opens newest-first and skips an empty history', () => {
    expect(openEditOverlay(items)).toEqual({
      kind: 'edit-message',
      items: [
        { seq: 2, text: 'second message', forkBoundary: 1 },
        { seq: 0, text: 'first message', forkBoundary: -1 },
      ],
      selected: 0,
    })
    expect(openEditOverlay([])).toBeUndefined()
  })

  it('selects with arrows and returns the message on Enter', () => {
    const open = openEditOverlay(items)! as Extract<ReturnType<typeof openEditOverlay>, { kind: 'edit-message' }>
    const down = editOverlayKey(open, '', key({ downArrow: true })) as Extract<typeof open, { kind: 'edit-message' }>
    expect(down.selected).toBe(1)
    const up = editOverlayKey(open, '', key({ upArrow: true })) as Extract<typeof open, { kind: 'edit-message' }>
    expect(up.selected).toBe(1)
    expect(editOverlayKey(open, '', key())).toEqual(open)
    expect(editOverlayKey(open, '\r', key())).toEqual({ edit: { seq: 2, text: 'second message', forkBoundary: 1 } })
    expect(editOverlayKey(open, '', key({ escape: true }))).toBeUndefined()
    expect(editOverlayKey(open, 'c', key({ ctrl: true }))).toBeUndefined()
    const empty = { kind: 'edit-message' as const, items: [] as const, selected: 0 }
    expect(editOverlayKey(empty, '', key({ downArrow: true }))).toEqual(empty)
    expect(editOverlayKey(empty, '', key({ upArrow: true }))).toEqual(empty)
    expect(editOverlayKey(empty, '\r', key())).toBeUndefined()
  })
})
