/**
 * The Codex-style composer edit engine: cursor-aware line editing with a Vim
 * normal-mode subset. Pure over the editing state and one parsed key, so the
 * whole key map is unit-testable without Ink. The App renders the returned
 * state; surface-level intents (quit, cancel, completion, history search)
 * bubble up as their own result kinds.
 * @module @deepseek-ai/dsh-tui/ui/composer
 */

import { isPrintable } from './keys.ts'
import type { KeyLike } from './keys.ts'

/** The composer's editing state. */
export interface ComposerEdit {
  /** The full composer text (may contain pasted line breaks). */
  text: string
  /** Cursor offset in UTF-16 code units, clamped to 0..text.length. */
  cursor: number
  /** Vim mode: Esc toggles; motions edit from normal, characters insert from insert. */
  vim: 'insert' | 'normal'
}

/**
 * The initial composer state: empty, cursor at 0, insert mode.
 * @returns the empty edit state.
 */
export function emptyEdit(): ComposerEdit {
  return { text: '', cursor: 0, vim: 'insert' }
}

/** What one composer key resolved to: a new editing state or a surface intent. */
export type ComposerResult =
  | { type: 'edit'; next: ComposerEdit }
  | { type: 'submit'; line: string; next: ComposerEdit }
  | { type: 'append-and-submit'; line: string; next: ComposerEdit }
  | { type: 'history-search' }
  | { type: 'quit' }
  | { type: 'cancel' }
  | { type: 'complete' }
  | { type: 'cycle-approval' }
  | { type: 'toggle-plan' }
  | { type: 'suggest-up' }
  | { type: 'suggest-down' }
  | { type: 'none' }

/** Clamp one cursor offset into 0..text.length. */
function clamp(text: string, cursor: number): number {
  return Math.max(0, Math.min(text.length, cursor))
}

/** Insert text at the cursor (multi-line paste included). */
function insert(edit: ComposerEdit, text: string): ComposerEdit {
  return {
    ...edit,
    text: edit.text.slice(0, edit.cursor) + text + edit.text.slice(edit.cursor),
    cursor: edit.cursor + text.length,
  }
}

/** Delete one character before the cursor (insert-mode backspace). */
function backspace(edit: ComposerEdit): ComposerEdit {
  if (edit.cursor === 0) return edit
  return {
    ...edit,
    text: edit.text.slice(0, edit.cursor - 1) + edit.text.slice(edit.cursor),
    cursor: edit.cursor - 1,
  }
}

/** Delete one character under the cursor (insert-mode Delete, normal-mode x). */
function deleteAt(edit: ComposerEdit): ComposerEdit {
  if (edit.cursor >= edit.text.length) return edit
  return { ...edit, text: edit.text.slice(0, edit.cursor) + edit.text.slice(edit.cursor + 1) }
}

/** The next word start at or after the cursor (Vim `w`). */
function nextWordStart(text: string, cursor: number): number {
  let index = cursor
  while (index < text.length && !/\s/.test(text.charAt(index))) index += 1
  while (index < text.length && /\s/.test(text.charAt(index))) index += 1
  return index
}

/** The previous word start before the cursor (Vim `b`). */
function prevWordStart(text: string, cursor: number): number {
  let index = Math.max(0, cursor - 1)
  while (index > 0 && /\s/.test(text.charAt(index))) index -= 1
  while (index > 0 && !/\s/.test(text.charAt(index - 1))) index -= 1
  return index
}

/** Apply one Vim normal-mode command; unrecognized commands leave the state unchanged. */
function normalCommand(edit: ComposerEdit, keyInput: string): ComposerEdit {
  switch (keyInput) {
    case 'h': return { ...edit, cursor: clamp(edit.text, edit.cursor - 1) }
    case 'l': return { ...edit, cursor: clamp(edit.text, edit.cursor + 1) }
    case '0': return { ...edit, cursor: 0 }
    case '$': return { ...edit, cursor: edit.text.length }
    case 'w': return { ...edit, cursor: nextWordStart(edit.text, edit.cursor) }
    case 'b': return { ...edit, cursor: prevWordStart(edit.text, edit.cursor) }
    case 'x': return deleteAt(edit)
    case 'D': return { ...edit, text: edit.text.slice(0, edit.cursor) }
    case 'i': return { ...edit, vim: 'insert' }
    case 'a': return { ...edit, cursor: clamp(edit.text, edit.cursor + 1), vim: 'insert' }
    case 'I': return { ...edit, cursor: 0, vim: 'insert' }
    case 'A': return { ...edit, cursor: edit.text.length, vim: 'insert' }
    default: return edit
  }
}

/**
 * Resolve one parsed key against the composer state. Insert mode edits text at
 * the cursor; normal mode applies the Vim motion subset; control keys (Ctrl+C,
 * Ctrl+D, Ctrl+P, Ctrl+R, Ctrl+U, Tab) work from either mode. Enter submits the
 * whole text and resets to the empty insert state.
 * @param edit - the current editing state.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @returns the next editing state and any surface intent.
 */
export function applyComposerKey(edit: ComposerEdit, keyInput: string, key: KeyLike): ComposerResult {
  if (key.ctrl && keyInput === 'c') return { type: 'cancel' }
  if (key.ctrl && keyInput === 'd') return { type: 'quit' }
  if (key.ctrl && keyInput === 'p') return { type: 'toggle-plan' }
  if (key.ctrl && keyInput === 'r') return { type: 'history-search' }
  if (key.ctrl && keyInput === 'u') return { type: 'edit', next: { text: '', cursor: 0, vim: 'insert' } }
  if (key.tab) return key.shift ? { type: 'cycle-approval' } : { type: 'complete' }
  if (key.escape) return {
    type: 'edit',
    next: { ...edit, vim: edit.vim === 'normal' ? 'insert' : 'normal' },
  }
  if (key.upArrow) return { type: 'suggest-up' }
  if (key.downArrow) return { type: 'suggest-down' }
  if (key.return || keyInput === '\r' || keyInput === '\n') {
    return { type: 'submit', line: edit.text, next: emptyEdit() }
  }
  if (key.leftArrow) return { type: 'edit', next: { ...edit, cursor: clamp(edit.text, edit.cursor - 1) } }
  if (key.rightArrow) return { type: 'edit', next: { ...edit, cursor: clamp(edit.text, edit.cursor + 1) } }
  if (key.backspace) return edit.vim === 'normal' ? { type: 'none' } : { type: 'edit', next: backspace(edit) }
  if (key.delete) return edit.vim === 'normal' ? { type: 'none' } : { type: 'edit', next: deleteAt(edit) }
  if (!isPrintable(keyInput, key)) return { type: 'none' }
  // An Enter that coalesced onto the tail of a typed chunk still ends the line.
  if (keyInput.endsWith('\r') || keyInput.endsWith('\n')) {
    const appended = insert(edit, keyInput.slice(0, -1))
    return { type: 'append-and-submit', line: appended.text, next: emptyEdit() }
  }
  if (edit.vim === 'normal') return { type: 'edit', next: normalCommand(edit, keyInput) }
  return { type: 'edit', next: insert(edit, keyInput) }
}
