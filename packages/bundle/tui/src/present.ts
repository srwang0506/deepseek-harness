/**
 * Tool-call presentation for the terminal: a concise human-readable title per
 * tool, and text extraction/truncation for results. These are pure functions
 * of the raw event payload, independent of the tool registry's render-intent
 * presenters (which the terminal surface does not load).
 * @module @deepseek-ai/dsh-tui/present
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Maximum Unicode code points a single tool summary may keep. */
const TITLE_LIMIT = 160

/**
 * Shorten one string to `limit` code points, appending an ellipsis when cut.
 * @param text - the source text.
 * @param limit - the code-point budget.
 * @returns the bounded text.
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/**
 * Parse one tool call's raw JSON arguments, tolerating malformed input.
 * @param argsJson - the model-produced arguments string.
 * @returns the parsed record, or an empty record when unparseable.
 */
function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** Read a string-valued field from parsed arguments. */
function field(args: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args[name]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/**
 * Produce the one-line title for a pending tool call.
 * @param name - the tool name.
 * @param argsJson - the raw arguments string.
 * @returns the concise title.
 */
export function toolCallTitle(name: string, argsJson: string): string {
  const args = parseArgs(argsJson)
  const path = field(args, 'file_path', 'path', 'directory')
  const command = field(args, 'command')
  const query = field(args, 'query', 'pattern')
  const url = field(args, 'url')
  const description = field(args, 'description')
  switch (name) {
    case 'bash':
    case 'tool-bash':
    case 'tool-bash-persistent':
    case 'pwsh':
    case 'tool-pwsh':
      return command === undefined ? name : truncate(command, TITLE_LIMIT)
    case 'write':
    case 'edit':
    case 'read':
    case 'str_replace_editor':
      return path === undefined ? name : `${name} ${truncate(path, TITLE_LIMIT)}`
    case 'grep':
    case 'glob':
      return query === undefined ? name : `${name} ${truncate(query, TITLE_LIMIT)}`
    case 'web_search':
      return query === undefined ? name : `${name} ${truncate(query, TITLE_LIMIT)}`
    case 'web_fetch':
      return url === undefined ? name : `${name} ${truncate(url, TITLE_LIMIT)}`
    case 'run_code':
      return description === undefined ? name : `${name} ${truncate(description, TITLE_LIMIT)}`
    case 'todo_write': {
      const todos = args['todos']
      if (Array.isArray(todos)) return `${name} (${todos.length} items)`
      return name
    }
    case 'ask_user_question': {
      const questions = args['questions']
      if (Array.isArray(questions) && questions.length > 0) {
        const first = (questions[0] as Record<string, unknown>)['question']
        return typeof first === 'string' ? truncate(first, TITLE_LIMIT) : name
      }
      return name
    }
    default:
      return argsJson.trim() === '' || argsJson === '{}'
        ? name
        : `${name} ${truncate(argsJson, TITLE_LIMIT)}`
  }
}

/**
 * Collect the plain text of one tool result's content blocks.
 * @param content - the result message's content blocks.
 * @returns the joined text.
 */
export function extractText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') {
      parts.push(block.text)
    } else if (block.type === 'tool-result') {
      parts.push(extractText(block.content))
    }
  }
  return parts.join('').trim()
}
