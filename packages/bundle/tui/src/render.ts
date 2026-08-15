/**
 * Session-event → terminal-text rendering. `renderEvent` dispatches one event;
 * the runner calls it for replay and for the live streaming feed alike. Text
 * streams raw in live mode (chunk deltas) and Markdown-styled in replay mode
 * (assembled messages).
 * @module @deepseek-ai/dsh-tui/render
 */

import type { ContentBlock, AssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { renderMarkdown } from './markdown.ts'
import { diffsFromMeta, renderFileDiffs } from './diff.ts'
import { extractText, toolCallTitle, truncate } from './present.ts'
import { bold, dim, grey, red, yellow } from './theme.ts'

/** Options controlling one render pass. */
export interface RenderOptions {
  /** Render assembled history (Markdown text, echoed user prompts). */
  replay?: boolean
  /** Code-point budget for a single tool-result body. */
  maxResultLength?: number
}

const DEFAULT_RESULT_LENGTH = 4000

/** Collect only the text blocks of a message, in order. */
function textBlocks(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
}

/** Indent every line by a fixed prefix. */
function indent(text: string, prefix: string): string {
  return text.split('\n').map(line => `${prefix}${line}`).join('\n')
}

/**
 * Render one human prompt for the replay transcript.
 * @param text - the prompt text.
 * @returns the prompt line.
 */
export function renderUserMessage(text: string): string {
  return `${grey('⏺')} ${text}`
}

/**
 * Render one assembled assistant text as styled Markdown.
 * @param text - the assistant text.
 * @returns the styled text.
 */
export function renderAssistantText(text: string): string {
  return renderMarkdown(text)
}

/**
 * Render one pending tool call as a one-line header.
 * @param name - the tool name.
 * @param argsJson - the raw arguments string.
 * @returns the header line.
 */
export function renderToolCall(name: string, argsJson: string): string {
  return `  ${grey('⏺')} ${bold(toolCallTitle(name, argsJson))}`
}

/**
 * Render one completed tool call: its result-time diff when present, else its
 * bounded result text.
 * @param event - the `tool/result` event.
 * @param maxResultLength - the result body budget.
 * @returns the result body, or an empty string when the result carries nothing.
 */
export function renderToolResult(event: SessionEvent<'tool/result'>, maxResultLength: number): string {
  const diffs = diffsFromMeta(event.data.meta)
  if (diffs !== undefined) {
    const rendered = renderFileDiffs(diffs)
    return rendered === '' ? '' : indent(rendered, '    ')
  }
  const text = extractText(event.data.message.content)
  const bounded = truncate(text, maxResultLength)
  if (bounded === '') return ''
  return indent(bounded.split('\n').map(dim).join('\n'), '    ')
}

/**
 * Render a terminal turn status line for non-completed endings.
 * @param reason - the turn end reason.
 * @returns the status line, or `undefined` for a clean completion.
 */
export function renderTurnStatus(reason: TurnEndReason): string | undefined {
  switch (reason.kind) {
    case 'completed':
      return undefined
    case 'aborted':
      return grey('(interrupted)')
    case 'blocked':
      return yellow('(blocked)')
    case 'max-tokens':
      return yellow('(max tokens reached)')
    case 'interrupted':
      return grey('(interrupted)')
    case 'error':
      return red(`${reason.error.code}: ${reason.error.message}`)
    default:
      return undefined
  }
}

/**
 * Render one durable session event as terminal text, or `undefined` when the
 * event has no terminal representation.
 * @param event - the committed event.
 * @param options - replay flag and result budget.
 * @returns the text to write, if any.
 */
export function renderEvent(event: SessionEvent, options: RenderOptions = {}): string | undefined {
  switch (event.type) {
    case 'user/message': {
      if (options.replay !== true) return undefined
      const text = textBlocks(event.data.content)
      return text === '' ? undefined : renderUserMessage(text)
    }
    case 'assistant/chunk': {
      if (options.replay === true) return undefined
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') return chunk.text
      if (chunk.type === 'reasoning-delta') return dim(chunk.text)
      return undefined
    }
    case 'assistant/message': {
      if (options.replay !== true) return undefined
      const text = assistantText(event.data.message)
      return text === '' ? undefined : renderAssistantText(text)
    }
    case 'tool/call':
      return renderToolCall(event.data.name, event.data.arguments)
    case 'tool/result':
      return renderToolResult(event, options.maxResultLength ?? DEFAULT_RESULT_LENGTH)
    case 'turn/end':
      return renderTurnStatus(event.data.reason)
    default:
      return undefined
  }
}

/** Collect an assistant message's visible text blocks (no reasoning, no tool calls). */
function assistantText(message: AssistantMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
}
