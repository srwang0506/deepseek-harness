/** Project-file index: collection, ignores, and depth-first ordering. */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFileIndex, isDirectory } from '../src/file-index.ts'

describe('buildFileIndex', () => {
  it('collects nested files as /-separated relative paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-file-index-'))
    mkdirSync(join(root, 'src', 'ui'), { recursive: true })
    writeFileSync(join(root, 'README.md'), 'x')
    writeFileSync(join(root, 'src', 'index.ts'), 'x')
    writeFileSync(join(root, 'src', 'ui', 'app.tsx'), 'x')
    symlinkSync(join(root, 'README.md'), join(root, 'link.md'))
    const index = buildFileIndex(root)
    expect(index).toEqual(['README.md', 'src/index.ts', 'src/ui/app.tsx'])
    expect(isDirectory(join(root, 'src'))).toBe(true)
  })

  it('skips hidden entries, node_modules, .git, and .dsh', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-file-index-skip-'))
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, '.git'), { recursive: true })
    mkdirSync(join(root, '.dsh'), { recursive: true })
    mkdirSync(join(root, '.hidden-dir'), { recursive: true })
    writeFileSync(join(root, 'a.ts'), 'x')
    writeFileSync(join(root, '.hidden.ts'), 'x')
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x')
    writeFileSync(join(root, '.git', 'HEAD'), 'x')
    writeFileSync(join(root, '.dsh', 'auth.json'), 'x')
    writeFileSync(join(root, '.hidden-dir', 'b.ts'), 'x')
    expect(buildFileIndex(root)).toEqual(['a.ts'])
  })

  it('tolerates an unreadable root', () => {
    expect(buildFileIndex('/definitely/not/a/real/dir')).toEqual([])
  })
})
