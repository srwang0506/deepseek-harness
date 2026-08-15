/** The composer edit engine: cursor editing, Vim motions, and surface intents. */

import { describe, expect, it } from 'vitest'
import { applyComposerKey, emptyEdit } from '../src/ui/composer.ts'
import type { ComposerEdit } from '../src/ui/composer.ts'
import type { KeyLike } from '../src/ui/keys.ts'

function key(overrides: Partial<KeyLike> = {}): KeyLike {
  return {
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    ...overrides,
  }
}

function edit(text: string, cursor = text.length, vim: ComposerEdit['vim'] = 'insert'): ComposerEdit {
  return { text, cursor, vim }
}

describe('emptyEdit', () => {
  it('starts empty at cursor 0 in insert mode', () => {
    expect(emptyEdit()).toEqual({ text: '', cursor: 0, vim: 'insert' })
  })
})

describe('insert-mode editing', () => {
  it('inserts characters at the cursor, not just at the end', () => {
    const result = applyComposerKey(edit('ac', 1), 'b', key())
    expect(result).toEqual({ type: 'edit', next: edit('abc', 2) })
  })

  it('backspaces the character before the cursor and tolerates cursor 0', () => {
    expect(applyComposerKey(edit('abc', 2), '', key({ backspace: true }))).toEqual({ type: 'edit', next: edit('ac', 1) })
    expect(applyComposerKey(edit('abc', 0), '', key({ backspace: true }))).toEqual({ type: 'edit', next: edit('abc', 0) })
  })

  it('deletes the character under the cursor and tolerates the line end', () => {
    expect(applyComposerKey(edit('abc', 1), '', key({ delete: true }))).toEqual({ type: 'edit', next: edit('ac', 1) })
    expect(applyComposerKey(edit('abc'), '', key({ delete: true }))).toEqual({ type: 'edit', next: edit('abc') })
  })

  it('moves the cursor with the arrow keys and clamps at the edges', () => {
    expect(applyComposerKey(edit('abc', 1), '', key({ leftArrow: true }))).toEqual({ type: 'edit', next: edit('abc', 0) })
    expect(applyComposerKey(edit('abc', 0), '', key({ leftArrow: true }))).toEqual({ type: 'edit', next: edit('abc', 0) })
    expect(applyComposerKey(edit('abc', 2), '', key({ rightArrow: true }))).toEqual({ type: 'edit', next: edit('abc', 3) })
    expect(applyComposerKey(edit('abc'), '', key({ rightArrow: true }))).toEqual({ type: 'edit', next: edit('abc') })
  })

  it('inserts multi-line paste text verbatim at the cursor', () => {
    expect(applyComposerKey(edit('a', 1), 'b\nc', key())).toEqual({ type: 'edit', next: edit('ab\nc', 4) })
  })
})

describe('submission', () => {
  it('submits the whole line and resets to the empty insert state', () => {
    expect(applyComposerKey(edit('fix the bug'), '\r', key())).toEqual({
      type: 'submit', line: 'fix the bug', next: emptyEdit(),
    })
    expect(applyComposerKey(edit('hi', 0), '', key({ return: true }))).toEqual({
      type: 'submit', line: 'hi', next: emptyEdit(),
    })
    expect(applyComposerKey(edit('hi'), '\n', key())).toEqual({
      type: 'submit', line: 'hi', next: emptyEdit(),
    })
  })

  it('appends a coalesced trailing Enter chunk before submitting it', () => {
    expect(applyComposerKey(edit('ab'), 'c\r', key())).toEqual({
      type: 'append-and-submit', line: 'abc', next: emptyEdit(),
    })
    expect(applyComposerKey(edit('xy', 1), 'z\n', key())).toEqual({
      type: 'append-and-submit', line: 'xzy', next: emptyEdit(),
    })
  })
})

describe('vim mode', () => {
  it('toggles between insert and normal with Esc, keeping text and cursor', () => {
    expect(applyComposerKey(edit('abc', 2), '', key({ escape: true }))).toEqual({ type: 'edit', next: edit('abc', 2, 'normal') })
    expect(applyComposerKey(edit('abc', 2, 'normal'), '', key({ escape: true }))).toEqual({ type: 'edit', next: edit('abc', 2) })
  })

  it('moves with h/l, 0, and $, clamped at the edges', () => {
    expect(applyComposerKey(edit('abc', 2, 'normal'), 'h', key())).toEqual({ type: 'edit', next: edit('abc', 1, 'normal') })
    expect(applyComposerKey(edit('abc', 0, 'normal'), 'h', key())).toEqual({ type: 'edit', next: edit('abc', 0, 'normal') })
    expect(applyComposerKey(edit('abc', 2, 'normal'), 'l', key())).toEqual({ type: 'edit', next: edit('abc', 3, 'normal') })
    expect(applyComposerKey(edit('abc', 2, 'normal'), '0', key())).toEqual({ type: 'edit', next: edit('abc', 0, 'normal') })
    expect(applyComposerKey(edit('abc', 1, 'normal'), '$', key())).toEqual({ type: 'edit', next: edit('abc', 3, 'normal') })
  })

  it('moves by words with w and b', () => {
    expect(applyComposerKey(edit('fix the bug', 0, 'normal'), 'w', key())).toEqual({ type: 'edit', next: edit('fix the bug', 4, 'normal') })
    expect(applyComposerKey(edit('fix the bug', 4, 'normal'), 'w', key())).toEqual({ type: 'edit', next: edit('fix the bug', 8, 'normal') })
    expect(applyComposerKey(edit('fix the bug', 8, 'normal'), 'b', key())).toEqual({ type: 'edit', next: edit('fix the bug', 4, 'normal') })
    expect(applyComposerKey(edit('fix the bug', 0, 'normal'), 'b', key())).toEqual({ type: 'edit', next: edit('fix the bug', 0, 'normal') })
    expect(applyComposerKey(edit('fix the bug', 11, 'normal'), 'w', key())).toEqual({ type: 'edit', next: edit('fix the bug', 11, 'normal') })
  })

  it('deletes with x under the cursor and D to the line end', () => {
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'x', key())).toEqual({ type: 'edit', next: edit('ac', 1, 'normal') })
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'D', key())).toEqual({ type: 'edit', next: edit('a', 1, 'normal') })
  })

  it('enters insert mode with i/a/I/A at the right cursor', () => {
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'i', key())).toEqual({ type: 'edit', next: edit('abc', 1) })
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'a', key())).toEqual({ type: 'edit', next: edit('abc', 2) })
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'I', key())).toEqual({ type: 'edit', next: edit('abc', 0) })
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'A', key())).toEqual({ type: 'edit', next: edit('abc') })
  })

  it('ignores unrecognized normal-mode commands and backspace', () => {
    expect(applyComposerKey(edit('abc', 1, 'normal'), 'q', key())).toEqual({ type: 'edit', next: edit('abc', 1, 'normal') })
    expect(applyComposerKey(edit('abc', 1, 'normal'), '', key({ backspace: true }))).toEqual({ type: 'none' })
    expect(applyComposerKey(edit('abc', 1, 'normal'), '', key({ delete: true }))).toEqual({ type: 'none' })
  })
})

describe('surface intents', () => {
  it('maps the control keys from either mode', () => {
    expect(applyComposerKey(edit('x'), '', key({ ctrl: true })).type).toBe('none')
    expect(applyComposerKey(edit('x'), 'c', key({ ctrl: true }))).toEqual({ type: 'cancel' })
    expect(applyComposerKey(edit('x'), 'd', key({ ctrl: true }))).toEqual({ type: 'quit' })
    expect(applyComposerKey(edit('x'), 'p', key({ ctrl: true }))).toEqual({ type: 'toggle-plan' })
    expect(applyComposerKey(edit('x'), 'r', key({ ctrl: true }))).toEqual({ type: 'history-search' })
    expect(applyComposerKey(edit('x', 1, 'normal'), 'r', key({ ctrl: true }))).toEqual({ type: 'history-search' })
    expect(applyComposerKey(edit('x'), 'u', key({ ctrl: true }))).toEqual({ type: 'edit', next: emptyEdit() })
  })

  it('maps Tab to completion and Shift+Tab to the approval cycle', () => {
    expect(applyComposerKey(edit('x'), '', key({ tab: true }))).toEqual({ type: 'complete' })
    expect(applyComposerKey(edit('x'), '', key({ tab: true, shift: true }))).toEqual({ type: 'cycle-approval' })
  })

  it('maps the arrow-up/down history intents and ignores other named keys', () => {
    expect(applyComposerKey(edit('x'), '', key({ upArrow: true }))).toEqual({ type: 'suggest-up' })
    expect(applyComposerKey(edit('x'), '', key({ downArrow: true }))).toEqual({ type: 'suggest-down' })
    expect(applyComposerKey(edit('x'), '', key())).toEqual({ type: 'none' })
  })
})
