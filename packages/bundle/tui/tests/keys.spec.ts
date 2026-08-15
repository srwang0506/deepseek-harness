import { describe, expect, it } from 'vitest'
import { keyIntent, type KeyLike, type PromptMode } from '../src/ui/keys.ts'

function key(partial: Partial<KeyLike> = {}): KeyLike {
  return {
    return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false,
    delete: false, meta: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    ...partial,
  }
}

const choice = (choices: readonly string[]): PromptMode => ({ kind: 'choice', choices })
const text = (choices: readonly string[] = [], multiLine = false): PromptMode => ({ kind: 'text', choices, multiLine })

describe('keyIntent', () => {
  it('submits on Enter', () => {
    expect(keyIntent('', key({ return: true }), undefined, '')).toEqual({ type: 'submit' })
  })

  it('routes Ctrl+C, Ctrl+D, Ctrl+P, Shift+Tab, and Tab', () => {
    expect(keyIntent('c', key({ ctrl: true }), undefined, '')).toEqual({ type: 'cancel' })
    expect(keyIntent('d', key({ ctrl: true }), undefined, '')).toEqual({ type: 'quit' })
    expect(keyIntent('p', key({ ctrl: true }), undefined, '')).toEqual({ type: 'toggle-plan' })
    expect(keyIntent('', key({ tab: true, shift: true }), undefined, '')).toEqual({ type: 'cycle-approval' })
    expect(keyIntent('', key({ tab: true }), undefined, '')).toEqual({ type: 'complete' })
  })

  it('appends printable chars and handles backspace/escape', () => {
    expect(keyIntent('a', key(), undefined, '')).toEqual({ type: 'append', text: 'a' })
    expect(keyIntent('', key({ backspace: true }), undefined, '')).toEqual({ type: 'backspace' })
    expect(keyIntent('', key({ escape: true }), undefined, '')).toEqual({ type: 'clear' })
  })

  it('answers a closed choice prompt; Ctrl+C still cancels the run', () => {
    expect(keyIntent('y', key(), choice(['y', 'n']), '')).toEqual({ type: 'prompt-answer', value: 'y' })
    expect(keyIntent('', key({ return: true }), choice(['y', 'n']), '')).toEqual({ type: 'prompt-answer', value: '\r' })
    expect(keyIntent('', key({ escape: true }), choice(['y', 'n']), '')).toEqual({ type: 'prompt-answer', value: null })
    expect(keyIntent('d', key({ ctrl: true }), choice(['y', 'n']), '')).toEqual({ type: 'prompt-answer', value: null })
    expect(keyIntent('c', key({ ctrl: true }), choice(['y', 'n']), '')).toEqual({ type: 'cancel' })
    expect(keyIntent('x', key(), choice(['y', 'n']), '')).toEqual({ type: 'none' })
  })

  it('collects text prompts, firing number shortcuts only from an empty buffer', () => {
    expect(keyIntent('', key({ return: true }), text(), 'typed')).toEqual({ type: 'prompt-return' })
    expect(keyIntent('x', key(), text(), '')).toEqual({ type: 'prompt-text', text: 'x' })
    expect(keyIntent('', key({ backspace: true }), text(), 'a')).toEqual({ type: 'prompt-text', text: '\b' })
    expect(keyIntent('', key({ escape: true }), text(), 'a')).toEqual({ type: 'prompt-answer', value: null })
    expect(keyIntent('2', key(), text(['1', '2']), '')).toEqual({ type: 'prompt-answer', value: '2' })
    expect(keyIntent('2', key(), text(['1', '2']), 'a')).toEqual({ type: 'prompt-text', text: '2' })
  })

  it('dismisses an empty text prompt with Ctrl+D, like Esc', () => {
    expect(keyIntent('d', key({ ctrl: true }), text(), '')).toEqual({ type: 'prompt-answer', value: null })
    expect(keyIntent('d', key({ ctrl: true }), text(), 'mid-line')).toEqual({ type: 'none' })
  })

  it('appends text and submits when a chunk ends with Enter', () => {
    expect(keyIntent('world\r', key(), undefined, '')).toEqual({ type: 'append-and-submit', text: 'world' })
    expect(keyIntent('world\n', key(), undefined, '')).toEqual({ type: 'append-and-submit', text: 'world' })
    expect(keyIntent('mid\rline', key(), undefined, '')).toEqual({ type: 'append', text: 'mid\rline' })
  })

  it('treats a bare CR or LF input as Enter, like key.return', () => {
    expect(keyIntent('\r', key(), undefined, '')).toEqual({ type: 'submit' })
    expect(keyIntent('\n', key(), undefined, '')).toEqual({ type: 'submit' })
    expect(keyIntent('\n', key(), choice(['y', 'n']), '')).toEqual({ type: 'prompt-answer', value: '\r' })
    expect(keyIntent('\n', key(), text(), 'typed')).toEqual({ type: 'prompt-return' })
  })

  it('routes the arrow keys and ignores other named keys', () => {
    expect(keyIntent('', key({ upArrow: true }), undefined, '')).toEqual({ type: 'suggest-up' })
    expect(keyIntent('', key({ downArrow: true }), undefined, '')).toEqual({ type: 'suggest-down' })
    expect(keyIntent('', key({ leftArrow: true }), undefined, '')).toEqual({ type: 'none' })
    expect(keyIntent('', key({ leftArrow: true }), text(), '')).toEqual({ type: 'none' })
    expect(keyIntent('', key({ delete: true }), choice(['y', 'n']), '')).toEqual({ type: 'none' })
  })
})
