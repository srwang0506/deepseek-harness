import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completeMention, extractMentions, readMention, suggestMentions } from '../src/mention.ts'

describe('mention', () => {
  it('extracts @-prefixed path tokens in order', () => {
    expect(extractMentions('fix @README.md and @src/index.ts')).toEqual(['README.md', 'src/index.ts'])
    expect(extractMentions('no mentions here')).toEqual([])
  })

  it('reads a mention and rejects missing or binary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mention-'))
    writeFileSync(join(dir, 'a.txt'), 'hello')
    expect(readMention('a.txt', dir)).toMatchObject({ path: 'a.txt', content: 'hello', truncated: false })
    expect(readMention('missing.txt', dir)).toBeUndefined()
  })

  it('completes a @-prefixed path to the single match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mention-comp-'))
    writeFileSync(join(dir, 'alpha.txt'), '')
    writeFileSync(join(dir, 'beta.txt'), '')
    expect(completeMention('@al', 3, dir)).toBe('@alpha.txt')
    expect(completeMention('@c', 2, dir)).toBeUndefined()
  })

  it('suggests @-prefixed path completions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mention-suggest-'))
    writeFileSync(join(dir, 'alpha.txt'), '')
    writeFileSync(join(dir, 'beta.txt'), '')
    expect(suggestMentions('@a', 2, dir)).toEqual(['alpha.txt'])
    expect(suggestMentions('@', 1, dir)).toEqual(['alpha.txt', 'beta.txt'])
    expect(suggestMentions('@z', 2, dir)).toEqual([])
  })
})
