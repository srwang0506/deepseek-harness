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
import type { UiOverlay } from './store.ts'

/**
 * Resolve one parsed key against an open overlay. Query changes re-rank the
 * matches through the supplied rank function, so the App decides which
 * candidate source (submitted history or the project-file index) backs the
 * overlay while this reducer stays pure.
 * @param overlay - the current overlay snapshot.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @param rank - resolves the ranked matches for one query string.
 * @returns the next overlay, `{ insert: text }` to close and insert, or
 *   `undefined` to close without inserting.
 */
export function overlayKey(
  overlay: UiOverlay,
  keyInput: string,
  key: KeyLike,
  rank: (query: string) => string[],
): UiOverlay | { insert: string } | undefined {
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
export function openHistoryOverlay(history: readonly string[]): UiOverlay | undefined {
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
export function openFilesOverlay(rank: (query: string) => string[], query = ''): UiOverlay {
  return { kind: 'files', query, matches: rank(query), selected: 0 }
}
