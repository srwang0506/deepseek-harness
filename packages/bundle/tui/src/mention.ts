/**
 * @-mention handling: resolve `@path` tokens in a prompt to file content, and
 * complete a `@`-prefixed path from the working directory's entries.
 * @module @deepseek-ai/dsh-tui/mention
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Maximum bytes read per mentioned file. */
export const MAX_MENTION_BYTES = 64 * 1024

/** One resolved mention. */
export interface ResolvedMention {
  /** The `@`-token path as typed (not absolutized). */
  path: string
  /** The file's text, truncated to {@link MAX_MENTION_BYTES} when larger. */
  content: string
  /** Whether the file exceeded the byte budget. */
  truncated: boolean
}

/**
 * Extract `@`-prefixed path tokens from a prompt line, in appearance order.
 * @param line - the raw prompt text.
 * @returns the token paths without their leading `@`.
 */
export function extractMentions(line: string): string[] {
  const tokens = line.match(/@([^\s@]+)/g) ?? []
  return tokens.map(token => token.slice(1))
}

/**
 * Read one mentioned path as UTF-8 text, bounded and binary-safe.
 * @param path - the token path (relative to `cwd`).
 * @param cwd - the working directory the path resolves against.
 * @returns the resolved mention, or `undefined` when missing, not a file, or binary.
 */
export function readMention(path: string, cwd: string): ResolvedMention | undefined {
  const absolute = resolve(cwd, path)
  let stat
  try {
    stat = statSync(absolute)
  } catch {
    return undefined
  }
  if (!stat.isFile()) return undefined
  const buffer = readFileSync(absolute)
  if (buffer.includes(0)) return undefined
  const truncated = buffer.byteLength > MAX_MENTION_BYTES
  const slice = truncated ? buffer.subarray(0, MAX_MENTION_BYTES) : buffer
  return { path, content: slice.toString('utf8'), truncated }
}

/**
 * List the `@`-prefixed path completions for a prompt line, for a popup.
 * @param line - the current input buffer.
 * @param cursor - the cursor offset (suggestions only apply at end-of-line).
 * @param cwd - the working directory to list from.
 * @returns the matching paths (name-sorted), or an empty list.
 */
export function suggestMentions(line: string, cursor: number, cwd: string): string[] {
  if (cursor !== line.length) return []
  const at = line.lastIndexOf('@')
  if (at === -1) return []
  const prefix = line.slice(at + 1)
  const slash = prefix.lastIndexOf('/')
  const base = slash === -1 ? '' : prefix.slice(0, slash + 1)
  const name = prefix.slice(base.length)
  let entries
  try {
    entries = readdirSync(join(cwd, base === '' ? '.' : base), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .map(entry => base + entry.name + (entry.isDirectory() ? '/' : ''))
    .filter(entry => entry.startsWith(name))
    .sort()
}

/**
 * Complete a `@`-prefixed path at the end of a line from directory entries.
 * @param line - the current input buffer.
 * Replace the trailing `@`-prefix with a chosen completion.
 * @param line - the current input buffer.
 * @param chosen - the full chosen path (with any directory prefix).
 * @returns the line with the chosen path substituted.
 */
export function selectMention(line: string, chosen: string): string {
  const at = line.lastIndexOf('@')
  if (at === -1) return line
  return line.slice(0, at + 1) + chosen
}

/**
 * Complete a `@`-prefixed path at the end of a line from directory entries.
 * @param line - the current input buffer.
 * @param cursor - the cursor offset (completion only applies at end-of-line).
 * @param cwd - the working directory to list from.
 * @returns the completed line, or `undefined` when there is nothing to complete.
 */
export function completeMention(line: string, cursor: number, cwd: string): string | undefined {
  if (cursor !== line.length) return undefined
  const at = line.lastIndexOf('@')
  if (at === -1) return undefined
  const prefix = line.slice(at + 1)
  const slash = prefix.lastIndexOf('/')
  const base = slash === -1 ? '' : prefix.slice(0, slash + 1)
  const name = prefix.slice(base.length)
  let entries
  try {
    entries = readdirSync(join(cwd, base === '' ? '.' : base), { withFileTypes: true })
  } catch {
    return undefined
  }
  const matches = entries
    .map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
    .filter(entry => entry.startsWith(name))
    .sort()
  const first = matches[0]
  if (first === undefined) return undefined
  if (matches.length === 1) return `${line.slice(0, at + 1)}${base}${first}`
  let common = first
  for (const match of matches.slice(1)) {
    while (common !== '' && !match.startsWith(common)) common = common.slice(0, -1)
  }
  return `${line.slice(0, at + 1)}${base}${common}`
}
