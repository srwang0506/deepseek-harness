/**
 * Terminal window-title output for the TUI, mirroring codex-rs's
 * `terminal_title.rs`: one sanitized OSC-0 sequence to stdout, bounded and
 * stripped of control/invisible characters. Clearing is a separate step
 * because restoring the shell's prior title is not portable.
 * @module @deepseek-ai/dsh-tui/terminal-title
 */

/** Practical title bound in characters, leaving headroom for OSC framing. */
const MAX_TITLE_CHARS = 240

/**
 * Strip control characters, bidi/invisible formatting, and collapse
 * whitespace runs, mirroring codex-rs's title sanitization.
 * @param title - the raw, untrusted title text.
 * @returns one bounded, visible-only title line.
 */
export function sanitizeTitle(title: string): string {
  let out = ''
  let pendingSpace = false
  for (const char of title) {
    // codePointAt is never undefined here: `char` is one non-empty character.
    const code = char.codePointAt(0) as number
    // Whitespace (including newlines and tabs) collapses to one space.
    if (/\s/.test(char)) {
      pendingSpace = out.length > 0
      continue
    }
    // Other control characters (0x00-0x1f, 0x7f) drop outright.
    if (code < 0x20 || code === 0x7f) continue
    if (pendingSpace) {
      out += ' '
      pendingSpace = false
    }
    out += char
    if (out.length >= MAX_TITLE_CHARS) break
  }
  return out
}

/**
 * Write the OSC-0 window/tab title sequence, only when stdout is a terminal.
 * @param title - the sanitized title to show.
 */
export function setTerminalTitle(title: string): void {
  if (!process.stdout.isTTY) return
  const clean = sanitizeTitle(title)
  if (clean === '') return
  process.stdout.write(`\x1b]0;${clean}\x07`)
}

/** Clear the title the TUI wrote; it does not restore any prior shell title. */
export function clearTerminalTitle(): void {
  if (!process.stdout.isTTY) return
  process.stdout.write('\x1b]0;\x07')
}
