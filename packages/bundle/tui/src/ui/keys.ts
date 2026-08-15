/**
 * Pure key-to-intent mapping for the terminal UI. The Ink app's `useInput`
 * callback translates one parsed key into a {@link KeyIntent}; this module is
 * the deterministic, testable core of that translation.
 * @module @deepseek-ai/dsh-tui/ui/keys
 */

/** The parsed-key shape Ink's `useInput` supplies. */
export interface KeyLike {
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
}

/**
 * One pending prompt's input mode: a closed single-key choice (approvals), or
 * free text with optional instant shortcuts that answer only from an empty
 * buffer (question presets).
 */
export type PromptMode =
  | { kind: 'choice'; choices: readonly string[] }
  | { kind: 'text'; choices: readonly string[]; multiLine: boolean }

/** What one key should do, resolved independent of the React state. */
export type KeyIntent =
  | { type: 'submit' }
  | { type: 'quit' }
  | { type: 'prompt-answer'; value: string | null }
  | { type: 'prompt-return' }
  | { type: 'prompt-text'; text: string }
  | { type: 'cycle-approval' }
  | { type: 'toggle-plan' }
  | { type: 'cancel' }
  | { type: 'complete' }
  | { type: 'suggest-up' }
  | { type: 'suggest-down' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'append'; text: string }
  | { type: 'append-and-submit'; text: string }
  | { type: 'none' }

/** What one key should do while the session picker is open. */
export type PickerIntent =
  | { type: 'picker-up' }
  | { type: 'picker-down' }
  | { type: 'picker-select' }
  | { type: 'picker-fork' }
  | { type: 'picker-cancel' }
  | { type: 'none' }

/**
 * Resolve one keypress into a picker intent: arrows move the highlight, Enter
 * resumes the selection, `f` forks it, and Esc cancels.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @returns the intent the app should apply.
 */
export function pickerIntent(keyInput: string, key: KeyLike): PickerIntent {
  if (key.upArrow) return { type: 'picker-up' }
  if (key.downArrow) return { type: 'picker-down' }
  if (key.return) return { type: 'picker-select' }
  if (key.escape) return { type: 'picker-cancel' }
  if (keyInput === 'f' && !key.ctrl && !key.meta) return { type: 'picker-fork' }
  return { type: 'none' }
}

/**
 * Whether the key is a plain printable character (not a named/control key).
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @returns true for a printable chunk.
 */
export function isPrintable(keyInput: string, key: KeyLike): boolean {
  return keyInput !== ''
    && !key.ctrl
    && !key.meta
    && !key.tab
    && !key.upArrow
    && !key.downArrow
    && !key.leftArrow
    && !key.rightArrow
}

/**
 * Resolve one keypress into a UI intent. The first Ctrl+C always cancels the
 * running turn, even while a prompt is pending; outside prompts Ctrl+D quits.
 * A pending text prompt submits typed text on Enter, with `multiLine`
 * continuation decided by the app from the buffer; an empty text prompt
 * answered with Ctrl+D dismisses like Esc.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @param prompt - the pending prompt's input mode, or undefined outside prompts.
 * @param promptText - the text prompt's current buffer (shortcuts only fire when empty).
 * @returns the intent the app should apply.
 */
export function keyIntent(
  keyInput: string,
  key: KeyLike,
  prompt: PromptMode | undefined,
  promptText: string,
): KeyIntent {
  if (key.ctrl && keyInput === 'c') return { type: 'cancel' }
  if (prompt === undefined) {
    if (key.ctrl && keyInput === 'd') return { type: 'quit' }
    if (key.return || keyInput === '\r' || keyInput === '\n') return { type: 'submit' }
    if (key.tab) return key.shift ? { type: 'cycle-approval' } : { type: 'complete' }
    if (key.upArrow) return { type: 'suggest-up' }
    if (key.downArrow) return { type: 'suggest-down' }
    if (key.ctrl && keyInput === 'p') return { type: 'toggle-plan' }
    if (key.backspace) return { type: 'backspace' }
    if (key.escape) return { type: 'clear' }
    if (isPrintable(keyInput, key)) {
      // An Enter that coalesced onto the tail of a typed chunk still ends
      // the line: append the text and submit it together.
      if (keyInput.endsWith('\r') || keyInput.endsWith('\n')) {
        return { type: 'append-and-submit', text: keyInput.slice(0, -1) }
      }
      return { type: 'append', text: keyInput }
    }
    return { type: 'none' }
  }
  if (prompt.kind === 'choice') {
    if (key.ctrl && keyInput === 'd') return { type: 'prompt-answer', value: null }
    if (key.return || keyInput === '\r' || keyInput === '\n') return { type: 'prompt-answer', value: '\r' }
    if (key.escape) return { type: 'prompt-answer', value: null }
    if (prompt.choices.includes(keyInput)) return { type: 'prompt-answer', value: keyInput }
    return { type: 'none' }
  }
  if (key.ctrl && keyInput === 'd') return promptText === '' ? { type: 'prompt-answer', value: null } : { type: 'none' }
  if (key.escape) return { type: 'prompt-answer', value: null }
  if (key.backspace) return { type: 'prompt-text', text: '\b' }
  if (key.return || keyInput === '\r' || keyInput === '\n') return { type: 'prompt-return' }
  if (isPrintable(keyInput, key)) {
    if (promptText === '' && prompt.choices.includes(keyInput)) return { type: 'prompt-answer', value: keyInput }
    return { type: 'prompt-text', text: keyInput }
  }
  return { type: 'none' }
}
