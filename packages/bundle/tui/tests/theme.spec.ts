import { afterEach, describe, expect, it } from 'vitest'
import { bold, colorEnabled, cyan, dim, setColorEnabled } from '../src/theme.ts'

afterEach(() => { setColorEnabled(true) })

describe('theme', () => {
  it('emits ANSI sequences when color is enabled', () => {
    setColorEnabled(true)
    expect(bold('x')).toBe('\u001b[1mx\u001b[0m')
    expect(cyan('y')).toBe('\u001b[36my\u001b[0m')
    expect(colorEnabled()).toBe(true)
  })

  it('passes text through unchanged when color is disabled', () => {
    setColorEnabled(false)
    expect(bold('x')).toBe('x')
    expect(dim('y')).toBe('y')
    expect(colorEnabled()).toBe(false)
  })
})
