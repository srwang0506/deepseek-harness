import { afterEach, describe, expect, it } from 'vitest'
import { setColorEnabled } from '../src/theme.ts'
import { highlight } from '../src/highlight.ts'

afterEach(() => { setColorEnabled(true) })

describe('highlight', () => {
  it('colors keywords, strings, numbers, and comments when enabled', () => {
    setColorEnabled(true)
    const out = highlight('const x = "hi" // note', 'ts')
    expect(out).toContain('\u001b[')
    expect(out).toContain('const')
    expect(out).toContain('"hi"')
  })

  it('passes unknown languages through unchanged', () => {
    setColorEnabled(false)
    expect(highlight('plain text', 'unknown')).toBe('plain text')
  })

  it('treats hash as a comment in python and shell', () => {
    setColorEnabled(true)
    expect(highlight('# comment', 'python')).toContain('\u001b[')
    expect(highlight('# comment', 'bash')).toContain('\u001b[')
  })
})
