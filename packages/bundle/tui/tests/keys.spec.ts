import { describe, expect, it } from 'vitest'
import { keyIntent, type KeyLike } from '../src/ui/keys.ts'

function key(partial: Partial<KeyLike> = {}): KeyLike {
  return {
    return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false,
    delete: false, meta: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    ...partial,
  }
}

describe('keyIntent', () => {
  it('submits on Enter', () => {
    expect(keyIntent('', key({ return: true }), false, [])).toEqual({ type: 'submit' })
  })

  it('routes Ctrl+C, Ctrl+P, Shift+Tab, and Tab', () => {
    expect(keyIntent('c', key({ ctrl: true }), false, [])).toEqual({ type: 'cancel' })
    expect(keyIntent('p', key({ ctrl: true }), false, [])).toEqual({ type: 'toggle-plan' })
    expect(keyIntent('', key({ tab: true, shift: true }), false, [])).toEqual({ type: 'cycle-approval' })
    expect(keyIntent('', key({ tab: true }), false, [])).toEqual({ type: 'complete' })
  })

  it('appends printable chars and handles backspace/escape', () => {
    expect(keyIntent('a', key(), false, [])).toEqual({ type: 'append', text: 'a' })
    expect(keyIntent('', key({ backspace: true }), false, [])).toEqual({ type: 'backspace' })
    expect(keyIntent('', key({ escape: true }), false, [])).toEqual({ type: 'clear' })
  })

  it('answers a choice prompt', () => {
    expect(keyIntent('y', key(), true, ['y', 'n'])).toEqual({ type: 'prompt-answer', value: 'y' })
    expect(keyIntent('', key({ return: true }), true, ['y', 'n'])).toEqual({ type: 'prompt-answer', value: '\r' })
    expect(keyIntent('', key({ escape: true }), true, ['y', 'n'])).toEqual({ type: 'prompt-answer', value: null })
  })

  it('handles a free-text prompt', () => {
    expect(keyIntent('', key({ return: true }), true, [])).toEqual({ type: 'prompt-submit' })
    expect(keyIntent('x', key(), true, [])).toEqual({ type: 'prompt-text', text: 'x' })
    expect(keyIntent('', key({ backspace: true }), true, [])).toEqual({ type: 'prompt-text', text: '\b' })
  })
})
