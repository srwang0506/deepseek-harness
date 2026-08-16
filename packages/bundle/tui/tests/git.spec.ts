/** git branch discovery for the status line. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitBranch } from '../src/git.ts'

describe('gitBranch', () => {
  it('resolves the symbolic HEAD branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-git-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    expect(gitBranch(root)).toBe('main')
  })

  it('omits a detached HEAD and a non-repository', () => {
    const detached = mkdtempSync(join(tmpdir(), 'dsh-git-detached-'))
    mkdirSync(join(detached, '.git'), { recursive: true })
    writeFileSync(join(detached, '.git', 'HEAD'), '0123456789abcdef\n')
    expect(gitBranch(detached)).toBeUndefined()
    expect(gitBranch(mkdtempSync(join(tmpdir(), 'dsh-git-none-')))).toBeUndefined()
  })

  it('omits an empty branch name', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-git-empty-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/\n')
    expect(gitBranch(root)).toBeUndefined()
  })
})
