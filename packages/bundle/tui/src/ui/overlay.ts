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

/** The ranked matches for one query over one candidate set. */
function matchesFor(overlay: UiOverlay, candidates: readonly string[]): string[] {
  return fuzzyFilter(overlay.query, candidates, candidate => candidate, 8)
}

/**
 * Resolve one parsed key against an open overlay.
 * @param overlay - the current overlay snapshot.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @param candidates - the full candidate set (history lines or file paths).
 * @returns the next overlay, `{ insert: text }` to close and insert, or
 *   `undefined` to close without inserting.
 */
export function overlayKey(
  overlay: UiOverlay,
  keyInput: string,
  key: KeyLike,
  candidates: readonly string[],
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
    return { ...overlay, query, matches: matchesFor({ ...overlay, query }, candidates), selected: 0 }
  }
  if (isPrintable(keyInput, key)) {
    const query = overlay.query + keyInput
    return { ...overlay, query, matches: matchesFor({ ...overlay, query }, candidates), selected: 0 }
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
  const candidates = [...history].reverse()
  return { kind: 'history', query: '', matches: candidates.slice(0, 8), selected: 0 }
}
