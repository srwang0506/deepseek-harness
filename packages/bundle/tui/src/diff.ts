/**
 * Unified-diff rendering for file mutations. `diff`'s `structuredPatch`
 * produces the hunks; this module formats them deterministically (no
 * timestamps) and colors insertions, deletions, and hunk headers.
 * @module @deepseek-ai/dsh-tui/diff
 */

import { structuredPatch } from 'diff'
import type { FileDiff } from '@deepseek-ai/dsh-tools/presentation'
import { brightGreen, brightRed, cyan, dim, grey } from './theme.ts'

/**
 * Color one hunk line: insertions green, deletions red, no-newline markers dim.
 * @param line - one `structuredPatch` hunk line (already ` `/`+`/`-`/`\\`-prefixed).
 * @returns the colored line.
 */
function colorizeHunkLine(line: string): string {
  if (line.startsWith('\\')) return dim(line)
  if (line.startsWith('+')) return brightGreen(line)
  if (line.startsWith('-')) return brightRed(line)
  return line
}

/**
 * Narrow an opaque tool-result `meta` payload to its file diffs, when present.
 * @param meta - the tool-private `tool/result.meta` value.
 * @returns the diffs, or `undefined` when `meta` carries none.
 */
export function diffsFromMeta(meta: unknown): readonly FileDiff[] | undefined {
  if (meta === null || typeof meta !== 'object') return undefined
  const candidate = (meta as Record<string, unknown>)['diffs']
  if (!Array.isArray(candidate)) return undefined
  const diffs = candidate.filter((entry): entry is FileDiff =>
    entry !== null && typeof entry === 'object'
    && typeof (entry as Record<string, unknown>)['path'] === 'string'
    && typeof (entry as Record<string, unknown>)['newText'] === 'string')
  return diffs.length === 0 ? undefined : diffs
}

/**
 * Render a list of file diffs as colored unified patches.
 * @param diffs - the file changes, in display order.
 * @returns the colored patches, separated by blank lines.
 */
/**
 * Render a list of file diffs as plain unified patches (no ANSI), for UI
 * surfaces that color through their own component styling.
 * @param diffs - the file changes, in display order.
 * @returns the plain patches, separated by blank lines.
 */
export function plainFileDiffs(diffs: readonly FileDiff[]): string {
  const blocks: string[] = []
  for (const entry of diffs) {
    const patch = structuredPatch(entry.path, entry.path, entry.oldText ?? '', entry.newText)
    if (patch.hunks.length === 0) continue
    const lines: string[] = [`--- ${entry.path}`, `+++ ${entry.path}`]
    for (const hunk of patch.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
      for (const line of hunk.lines) lines.push(line)
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/**
 * Render a list of file diffs as colored unified patches (ANSI), for the
 * one-shot/legacy text path.
 * @param diffs - the file changes, in display order.
 * @returns the colored patches, separated by blank lines.
 */
export function renderFileDiffs(diffs: readonly FileDiff[]): string {
  const blocks: string[] = []
  for (const entry of diffs) {
    const patch = structuredPatch(entry.path, entry.path, entry.oldText ?? '', entry.newText)
    if (patch.hunks.length === 0) continue
    const lines: string[] = [grey(`--- ${entry.path}`), grey(`+++ ${entry.path}`)]
    for (const hunk of patch.hunks) {
      lines.push(cyan(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`))
      for (const line of hunk.lines) lines.push(colorizeHunkLine(line))
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}
