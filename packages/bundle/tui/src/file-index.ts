/**
 * The project-file index behind the `@` search overlay: every non-ignored
 * regular file under the working directory, as repository-relative `/`-paths.
 * Built once per session, synchronously, skipping dependency and VCS
 * directories and hidden entries (the directories a code agent never
 * mentions). The walk never follows directory symlinks, so cycles cannot
 * recurse.
 * @module @deepseek-ai/dsh-tui/file-index
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Directory names never entered: dependencies, VCS, and harness state. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh'])

/** Collect one directory's files into a sink, depth-first. */
function collect(dir: string, prefix: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      collect(join(dir, entry.name), relative, out)
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.')) continue
      out.push(relative)
    }
  }
}

/**
 * Build the project-file index for `@` search.
 * @param cwd - the working directory to index.
 * @returns every collected file path, relative to `cwd` with `/` separators.
 */
export function buildFileIndex(cwd: string): string[] {
  const out: string[] = []
  collect(cwd, '', out)
  return out
}

/**
 * Whether one directory path is a directory (for tests that build fixtures).
 * @param path - the absolute path to test.
 * @returns true when the path is a directory.
 */
export function isDirectory(path: string): boolean {
  return statSync(path).isDirectory()
}
