/**
 * Slash-command parsing for the terminal loop. `parseSlash` recognizes a line
 * beginning with `/` and splits it into a command name and its argument text;
 * the runner interprets the vocabulary.
 * @module @deepseek-ai/dsh-tui/slash
 */

/** A parsed slash invocation. */
export interface ParsedSlash {
  /** The command name, lowercased. */
  name: string
  /** The remaining argument text, trimmed; empty when none. */
  args: string
}

/**
 * Split one input line into a slash command and its arguments.
 * @param line - the raw input line.
 * @returns the parsed command, or `undefined` when the line is not a slash
 *   command (or is a bare `/`).
 */
export function parseSlash(line: string): ParsedSlash | undefined {
  if (!line.startsWith('/')) return undefined
  const trimmed = line.slice(1).trim()
  if (trimmed === '') return undefined
  const space = /\s/.exec(trimmed)
  const name = space === null ? trimmed : trimmed.slice(0, space.index)
  const args = space === null ? '' : trimmed.slice(space.index + 1).trim()
  return { name: name.toLowerCase(), args }
}
