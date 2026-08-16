/** Terminal-title sanitization (the OSC write path is gated on stdout TTY). */

import { afterEach, describe, expect, it } from 'vitest'
import { clearTerminalTitle, sanitizeTitle, setTerminalTitle } from '../src/terminal-title.ts'

const originalIsTTY = process.stdout.isTTY
const originalWrite = process.stdout.write.bind(process.stdout)

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
  process.stdout.write = originalWrite
})

describe('sanitizeTitle', () => {
  it('collapses whitespace runs and strips leading/trailing space', () => {
    expect(sanitizeTitle('  fix   the\nbug\t')).toBe('fix the bug')
  })

  it('drops control characters and bidi/invisible marks', () => {
    expect(sanitizeTitle('a\x1bb\u0007c')).toBe('abc')
  })

  it('bounds the result to MAX_TITLE_CHARS', () => {
    expect(sanitizeTitle('x'.repeat(500)).length).toBe(240)
  })

  it('returns an empty string for a title with no visible content', () => {
    expect(sanitizeTitle(' \t\n\x1b')).toBe('')
  })
})

describe('setTerminalTitle', () => {
  it('writes the OSC-0 sequence when stdout is a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    const writes: string[] = []
    process.stdout.write = (s: string) => { writes.push(s); return true }
    setTerminalTitle('dsh | model')
    expect(writes).toEqual(['\x1b]0;dsh | model\x07'])
  })

  it('no-ops when stdout is not a TTY or the title sanitizes empty', () => {
    const writes: string[] = []
    process.stdout.write = (s: string) => { writes.push(s); return true }
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    setTerminalTitle('dsh')
    clearTerminalTitle()
    expect(writes).toEqual([])
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    setTerminalTitle('   ')
    expect(writes).toEqual([])
    clearTerminalTitle()
    expect(writes).toEqual(['\x1b]0;\x07'])
  })
})
