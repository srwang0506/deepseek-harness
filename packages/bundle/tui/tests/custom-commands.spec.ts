import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCustomCommands } from '../src/custom-commands.ts'

describe('loadCustomCommands', () => {
  it('loads prompt-template commands with a heading and body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-commands-'))
    writeFileSync(join(dir, 'review.md'), '# Review for bugs\nLook for bugs in the change. $ARGUMENTS\n')
    writeFileSync(join(dir, 'summarize.md'), 'Summarize the conversation.\n')
    const commands = loadCustomCommands(dir)
    expect(commands).toEqual([
      { name: 'review', description: 'Review for bugs', template: 'Look for bugs in the change. $ARGUMENTS' },
      { name: 'summarize', description: 'summarize', template: 'Summarize the conversation.' },
    ])
  })

  it('skips non-markdown files, invalid names, and empty bodies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-commands-'))
    writeFileSync(join(dir, 'ok.md'), 'Do something.\n')
    writeFileSync(join(dir, 'Bad Name.md'), 'Invalid name.\n')
    writeFileSync(join(dir, 'empty.md'), '# only a heading\n')
    writeFileSync(join(dir, 'notes.txt'), 'not markdown\n')
    expect(loadCustomCommands(dir).map(command => command.name)).toEqual(['ok'])
  })

  it('returns an empty list for a missing directory', () => {
    expect(loadCustomCommands(join(mkdtempSync(join(tmpdir(), 'dsh-nodir-')), 'missing'))).toEqual([])
  })
})
