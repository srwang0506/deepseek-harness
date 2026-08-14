/**
 * ANSI styling primitives for the terminal surface. Every helper is a pure
 * function of its text argument plus one module-level color toggle, so
 * renderers stay testable with color both on and off.
 * @module @deepseek-ai/dsh-tui/theme
 */

/** Standard SGR parameter values used by the renderers. */
const SGR = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  grey: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
} as const

/** Whether ANSI codes are emitted; toggled once by the runner from the terminal. */
let enabled = true

/**
 * Turn ANSI styling on or off for the whole process.
 * @param value - the new toggle state.
 */
export function setColorEnabled(value: boolean): void {
  enabled = value
}

/**
 * Whether ANSI styling is currently enabled.
 * @returns the current toggle state.
 */
export function colorEnabled(): boolean {
  return enabled
}

/**
 * Wrap text in one or more SGR sequences (reset-terminated).
 * @param codes - SGR parameters to apply.
 * @param text - the styled text.
 * @returns the styled text, or `text` unchanged when color is disabled.
 */
function paint(codes: readonly number[], text: string): string {
  if (!enabled || codes.length === 0) return text
  return `\u001b[${codes.join(';')}m${text}\u001b[0m`
}

/**
 * Bold text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const bold = (text: string): string => paint([SGR.bold], text)

/**
 * Dimmed text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const dim = (text: string): string => paint([SGR.dim], text)

/**
 * Italic text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const italic = (text: string): string => paint([SGR.italic], text)

/**
 * Red text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const red = (text: string): string => paint([SGR.red], text)

/**
 * Green text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const green = (text: string): string => paint([SGR.green], text)

/**
 * Yellow text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const yellow = (text: string): string => paint([SGR.yellow], text)

/**
 * Cyan text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const cyan = (text: string): string => paint([SGR.cyan], text)

/**
 * Magenta text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const magenta = (text: string): string => paint([SGR.magenta], text)

/**
 * Grey text.
 * @param text - the text to style.
 * @returns the styled text.
 */
export const grey = (text: string): string => paint([SGR.grey], text)

/**
 * Bright-red text (diff deletions).
 * @param text - the text to style.
 * @returns the styled text.
 */
export const brightRed = (text: string): string => paint([SGR.brightRed], text)

/**
 * Bright-green text (diff insertions).
 * @param text - the text to style.
 * @returns the styled text.
 */
export const brightGreen = (text: string): string => paint([SGR.brightGreen], text)
