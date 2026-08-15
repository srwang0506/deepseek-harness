/**
 * Pure key handling for the composer overlays (history and file search): one
 * overlay snapshot plus one parsed key resolves to the next snapshot, an
 * insertion, or a close. Query changes re-rank the candidate list through the
 * shared fuzzy matcher, so the App only renders the result.
 * @module @deepseek-ai/dsh-tui/ui/overlay
 */

import type { KeyLike } from './keys.ts'
import { isPrintable } from './keys.ts'
import { fuzzyFilter } from './fuzzy.ts'
import type { EditMessageItem, UiOverlay } from './store.ts'

/** A search overlay: the two overlay kinds the query-driven reducer owns. */
export type SearchOverlay = Extract<UiOverlay, { kind: 'history' | 'files' }>

/**
 * Resolve one parsed key against an open search overlay. Query changes
 * re-rank the matches through the supplied rank function, so the App decides
 * which candidate source (submitted history or the project-file index) backs
 * the overlay while this reducer stays pure.
 * @param overlay - the current search overlay snapshot.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @param rank - resolves the ranked matches for one query string.
 * @returns the next overlay, `{ insert: text }` to close and insert, or
 *   `undefined` to close without inserting.
 */
export function overlayKey(
  overlay: SearchOverlay,
  keyInput: string,
  key: KeyLike,
  rank: (query: string) => string[],
): SearchOverlay | { insert: string } | undefined {
  if (key.escape || (key.ctrl && keyInput === 'c')) return undefined
  if (key.return || keyInput === '\r' || keyInput === '\n') {
    const match = overlay.matches[overlay.selected]
    return match === undefined ? undefined : { insert: match }
  }
  if (key.upArrow) {
    if (overlay.matches.length === 0) return overlay
    return { ...overlay, selected: (overlay.selected - 1 + overlay.matches.length) % overlay.matches.length }
  }
  if (key.downArrow) {
    if (overlay.matches.length === 0) return overlay
    return { ...overlay, selected: (overlay.selected + 1) % overlay.matches.length }
  }
  if (key.backspace) {
    const query = overlay.query.slice(0, -1)
    return { ...overlay, query, matches: rank(query), selected: 0 }
  }
  if (isPrintable(keyInput, key)) {
    const query = overlay.query + keyInput
    return { ...overlay, query, matches: rank(query), selected: 0 }
  }
  return overlay
}

/**
 * Open a history overlay ranked over the submitted prompt history, newest
 * first. An empty history returns `undefined` so Ctrl+R is a no-op there.
 * @param history - submitted lines in oldest-first order.
 * @returns the overlay snapshot, or `undefined` when nothing was submitted.
 */
export function openHistoryOverlay(history: readonly string[]): SearchOverlay | undefined {
  if (history.length === 0) return undefined
  return { kind: 'history', query: '', matches: historyRank(history)(''), selected: 0 }
}

/**
 * The rank function for the history overlay: newest first, fuzzy-filtered,
 * bounded to 8 matches.
 * @param history - submitted lines in oldest-first order.
 * @returns a rank function over one query string.
 */
export function historyRank(history: readonly string[]): (query: string) => string[] {
  const newest = [...history].reverse()
  return (query: string): string[] => fuzzyFilter(query, newest, candidate => candidate, 8)
}

/**
 * Open a file-search overlay ranked by the supplied matcher. Unlike history,
 * the overlay opens even with no matches, so the header explains the empty
 * result while the user keeps typing.
 * @param rank - resolves the ranked file matches for one query.
 * @param query - the initial query text.
 * @returns the overlay snapshot.
 */
export function openFilesOverlay(rank: (query: string) => string[], query = ''): SearchOverlay {
  return { kind: 'files', query, matches: rank(query), selected: 0 }
}

/**
 * Open the edit overlay over the session's previous user messages, newest
 * first. An empty list returns `undefined` so ↑ is a no-op there.
 * @param items - the user messages in log order.
 * @returns the overlay snapshot, or `undefined` when nothing was submitted.
 */
export function openEditOverlay(items: readonly EditMessageItem[]): UiOverlay | undefined {
  if (items.length === 0) return undefined
  return { kind: 'edit-message', items: [...items].reverse(), selected: 0 }
}

/**
 * Resolve one parsed key against an open edit overlay: arrows move the
 * selection, Enter returns the chosen message for the composer to edit, and
 * Esc/Ctrl+C close without editing.
 * @param overlay - the edit overlay snapshot.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @returns the next overlay, the message to edit, or `undefined` to close.
 */
export function editOverlayKey(
  overlay: Extract<UiOverlay, { kind: 'edit-message' }>,
  keyInput: string,
  key: KeyLike,
): Extract<UiOverlay, { kind: 'edit-message' }> | { edit: EditMessageItem } | undefined {
  if (key.escape || (key.ctrl && keyInput === 'c')) return undefined
  if (key.return || keyInput === '\r' || keyInput === '\n') {
    const item = overlay.items[overlay.selected]
    return item === undefined ? undefined : { edit: item }
  }
  if (key.upArrow) {
    if (overlay.items.length === 0) return overlay
    return { ...overlay, selected: (overlay.selected - 1 + overlay.items.length) % overlay.items.length }
  }
  if (key.downArrow) {
    if (overlay.items.length === 0) return overlay
    return { ...overlay, selected: (overlay.selected + 1) % overlay.items.length }
  }
  return overlay
}
