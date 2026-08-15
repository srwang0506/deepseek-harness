/** Fuzzy subsequence scoring and ranking. */

import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '../src/ui/fuzzy.ts'

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('abc', 'aXbY')).toBeNull()
    expect(fuzzyScore('zz', 'hello')).toBeNull()
  })

  it('scores consecutive runs higher than scattered matches', () => {
    const consecutive = fuzzyScore('fix', 'fix the bug')
    const scattered = fuzzyScore('fix', 'fInd the miX')
    expect(consecutive).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(consecutive!).toBeGreaterThan(scattered!)
  })

  it('awards a boundary bonus and prefers earlier starts', () => {
    const boundary = fuzzyScore('src', 'src/index.ts')
    const embedded = fuzzyScore('src', 'othersrc/index.ts')
    expect(boundary).not.toBeNull()
    expect(embedded).not.toBeNull()
    expect(boundary!).toBeGreaterThan(embedded!)
  })

  it('matches case-insensitively', () => {
    expect(fuzzyScore('ABC', 'abc')).not.toBeNull()
  })

  it('awards the boundary bonus to a match right after a separator', () => {
    const separated = fuzzyScore('bug', 'fix/bug.ts')
    const embedded = fuzzyScore('bug', 'fixabug.ts')
    expect(separated).not.toBeNull()
    expect(embedded).not.toBeNull()
    expect(separated!).toBeGreaterThan(embedded!)
  })
})

describe('fuzzyFilter', () => {
  it('ranks best matches first and bounds the result', () => {
    const items = ['fuzzy.spec.ts', 'fix.ts', 'otherfile', 'fizz buzz']
    expect(fuzzyFilter('f', items, item => item, 3)).toEqual(['fuzzy.spec.ts', 'fix.ts', 'fizz buzz'])
  })

  it('drops non-matching items', () => {
    expect(fuzzyFilter('xyz', ['hello', 'world'], item => item, 10)).toEqual([])
  })
})
