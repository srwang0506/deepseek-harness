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

/** What one key should do, resolved independent of the React state. */
export type KeyIntent =
  | { type: 'submit' }
  | { type: 'prompt-answer'; value: string | null }
  | { type: 'prompt-submit' }
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
  | { type: 'none' }

/** Whether the key is a plain printable character (not a named/control key). */
function isPrintable(keyInput: string, key: KeyLike): boolean {
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
 * Resolve one keypress into a UI intent.
 * @param keyInput - the character (or paste) string, '' for named keys.
 * @param key - the parsed key flags.
 * @param promptActive - whether an approval/question prompt is pending.
 * @param promptChoices - the pending prompt's accepted keys (empty = free text).
 * @returns the intent the app should apply.
 */
export function keyIntent(
  keyInput: string,
  key: KeyLike,
  promptActive: boolean,
  promptChoices: readonly string[],
): KeyIntent {
  if (promptActive) {
    if (promptChoices.length === 0) {
      if (key.return) return { type: 'prompt-submit' }
      if (key.escape) return { type: 'prompt-answer', value: null }
      if (key.backspace) return { type: 'prompt-text', text: '\b' }
      if (isPrintable(keyInput, key)) return { type: 'prompt-text', text: keyInput }
      return { type: 'none' }
    }
    if (key.return) return { type: 'prompt-answer', value: '\r' }
    if (key.escape) return { type: 'prompt-answer', value: null }
    if (promptChoices.includes(keyInput)) return { type: 'prompt-answer', value: keyInput }
    return { type: 'none' }
  }
  if (key.ctrl && keyInput === 'c') return { type: 'cancel' }
  if (key.return) return { type: 'submit' }
  if (key.tab) return key.shift ? { type: 'cycle-approval' } : { type: 'complete' }
  if (key.upArrow) return { type: 'suggest-up' }
  if (key.downArrow) return { type: 'suggest-down' }
  if (key.ctrl && keyInput === 'p') return { type: 'toggle-plan' }
  if (key.backspace) return { type: 'backspace' }
  if (key.escape) return { type: 'clear' }
  if (isPrintable(keyInput, key)) return { type: 'append', text: keyInput }
  return { type: 'none' }
}
