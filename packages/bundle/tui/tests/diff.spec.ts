import { describe, expect, it } from 'vitest'
import { setColorEnabled } from '../src/theme.ts'
import { diffsFromMeta, renderFileDiffs } from '../src/diff.ts'

describe('renderFileDiffs', () => {
  it('renders insertions and deletions as a unified patch', () => {
    setColorEnabled(false)
    const out = renderFileDiffs([{ path: 'a.txt', oldText: 'old\nline\n', newText: 'new\nline\n' }])
    expect(out).toContain('--- a.txt')
    expect(out).toContain('+++ a.txt')
    expect(out).toContain('-old')
    expect(out).toContain('+new')
  })

  it('skips a diff with no changes', () => {
    setColorEnabled(false)
    expect(renderFileDiffs([{ path: 'a.txt', oldText: 'same\n', newText: 'same\n' }])).toBe('')
  })
})

describe('diffsFromMeta', () => {
  it('narrows valid diff metadata and rejects junk', () => {
    expect(diffsFromMeta({ diffs: [{ path: 'a', oldText: null, newText: 'x' }] })).toHaveLength(1)
    expect(diffsFromMeta(undefined)).toBeUndefined()
    expect(diffsFromMeta({ diffs: 'nope' })).toBeUndefined()
  })
})
