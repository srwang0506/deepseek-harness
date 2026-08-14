/**
 * User-defined slash commands loaded from `$DSH_HOME/commands/*.md`. Each file
 * is one prompt-template command: its basename (sans `.md`) is the command
 * name, an optional leading `# heading` is its description, and the remaining
 * body is the prompt template (a `$ARGUMENTS` placeholder is replaced by the
 * text typed after the command).
 * @module @deepseek-ai/dsh-tui/custom-commands
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** One loaded custom command. */
export interface CustomCommand {
  /** Lowercase command name without the leading slash. */
  name: string
  /** Human-readable description for discovery. */
  description: string
  /** The prompt template. */
  template: string
}

/** Valid custom-command names (same vocabulary as the registry). */
const NAME = /^[a-z][a-z0-9_-]*$/

/**
 * Load every `*.md` prompt-template command from a directory.
 * @param dir - the commands directory.
 * @returns the commands, name-sorted; unreadable dirs yield an empty list.
 */
export function loadCustomCommands(dir: string): CustomCommand[] {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const commands: CustomCommand[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const name = entry.slice(0, -3)
    if (!NAME.test(name)) continue
    const content = readFileSync(join(dir, entry), 'utf8')
    const lines = content.split('\n')
    const heading = /^#\s+(.*)$/.exec(lines[0] ?? '')
    const description = heading === null ? name : (heading[1] ?? name).trim()
    const body = heading === null ? content.trim() : lines.slice(1).join('\n').trim()
    if (body === '') continue
    commands.push({ name, description, template: body })
  }
  return commands.sort((left, right) => left.name.localeCompare(right.name))
}
