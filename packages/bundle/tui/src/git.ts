/**
 * Best-effort git branch discovery for the Codex-style status line. Reads
 * `.git/HEAD` and resolves the symbolic `ref: refs/heads/<name>` target;
 * detached HEADs and non-repositories return undefined.
 * @module @deepseek-ai/dsh-tui/git
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the checked-out branch name for a working directory, or undefined
 * when it is not a git worktree with a symbolic HEAD.
 * @param cwd - the working directory to inspect.
 * @returns the branch name, or undefined when unavailable.
 */
export function gitBranch(cwd: string): string | undefined {
  let head: string
  try {
    head = readFileSync(join(cwd, '.git', 'HEAD'), 'utf8').trim()
  } catch {
    return undefined
  }
  const prefix = 'ref: refs/heads/'
  if (!head.startsWith(prefix)) return undefined
  const branch = head.slice(prefix.length)
  return branch === '' ? undefined : branch
}
