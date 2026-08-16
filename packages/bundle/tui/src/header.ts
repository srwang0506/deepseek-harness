/**
 * Session-header facts: the app version and the home-relativized directory
 * that the Codex-style title card renders. Kept here so the two pure lookups
 * stay unit-testable without mounting the runner.
 * @module @deepseek-ai/dsh-tui/header
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The dsh version shown in the header title line. The CLI launcher sets
 * `DSH_VERSION`; when absent (an embedded/self-hosted tree) the tui bundle's
 * own manifest version is read, falling back to a zero version.
 * @returns the version string.
 */
export function appVersion(): string {
  if (process.env.DSH_VERSION !== undefined && process.env.DSH_VERSION !== '') return process.env.DSH_VERSION
  try {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    // The manifest is missing or unreadable in an embedded tree; a zero
    // version is the safe header fallback, never a startup failure.
    return '0.0.0'
  }
}

/**
 * Relativize an absolute directory to `~` when it sits under the home
 * directory, mirroring Codex's header directory label.
 * @param directory - the absolute working directory.
 * @returns `~`/`~/<relative>` when under home, else the directory unchanged.
 */
export function relativizeHome(directory: string): string {
  const home = homedir()
  if (directory === home) return '~'
  const prefix = home.endsWith(sep) ? home : home + sep
  return directory.startsWith(prefix) ? `~${sep}${directory.slice(prefix.length)}` : directory
}

/**
 * Center-truncate one string so its head and tail stay visible, Codex-style
 * path shortening for the header directory label.
 * @param text - the source text.
 * @param max - the code-point budget, including the ellipsis.
 * @returns the bounded text.
 */
export function centerTruncate(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  const tail = max - 1 - head
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
