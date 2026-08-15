/**
 * Fuzzy subsequence matching shared by the history and file search overlays.
 * Case-insensitive subsequence with scoring: consecutive runs and boundary
 * matches (line start or after a path/word separator) score higher, and an
 * earlier match start wins ties. Pure and dependency-free.
 * @module @deepseek-ai/dsh-tui/ui/fuzzy
 */

/** Separators that award a boundary bonus to a match right after them. */
const BOUNDARIES = new Set(['/', '\\', '-', '_', '.', ' '])

/**
 * Score one candidate against a query, or null when the query is not a
 * subsequence of the candidate. Higher scores rank first.
 * @param query - the typed search text.
 * @param candidate - one history line or file path to test.
 * @returns the score, or null when the candidate does not match.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = query.toLowerCase()
  const hay = candidate.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatch = -2
  let start = -1
  for (let ci = 0; ci < hay.length && qi < needle.length; ci += 1) {
    if (hay[ci] !== needle[qi]) continue
    if (start === -1) start = ci
    score += ci === lastMatch + 1 ? 10 : 5
    if (ci === 0 || BOUNDARIES.has(hay.charAt(ci - 1))) score += 5
    lastMatch = ci
    qi += 1
  }
  if (qi < needle.length) return null
  return score - start
}

/**
 * Rank every item whose text matches the query, best first, bounded.
 * @param query - the typed search text.
 * @param items - the candidates.
 * @param textOf - extracts the comparable text from one item.
 * @param limit - maximum returned matches.
 * @returns the matching items, best first, at most `limit`.
 */
export function fuzzyFilter<T>(query: string, items: readonly T[], textOf: (item: T) => string, limit: number): T[] {
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const score = fuzzyScore(query, textOf(item))
    if (score !== null) scored.push({ item, score })
  }
  return scored.sort((left, right) => right.score - left.score).slice(0, limit).map(entry => entry.item)
}
