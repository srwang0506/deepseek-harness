/**
 * The Ink terminal app: a full-screen layout (status bar, scrollable
 * conversation, input line) driven by a {@link UiStore} snapshot.
 * @module @deepseek-ai/dsh-tui/ui/app
 */

import React, { useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text, render, useInput } from 'ink'
import type { UiStore, UiItem } from './store.ts'
import { DiffView, MarkdownView } from './rich.tsx'
import { keyIntent } from './keys.ts'

/** Callbacks the app needs from the agent driver. */
export interface AppCallbacks {
  /** Submit one command line. */
  onSubmit: (line: string) => void
  /** Cycle the permission preset (Shift+Tab). */
  onCycleApproval: () => void
  /** Toggle plan mode (Ctrl+P). */
  onTogglePlan: () => void
  /** Complete a `@`-prefixed path at end-of-line, or return undefined. */
  onComplete: (line: string, cursor: number) => string | undefined
  /** Cancel the running turn (Ctrl+C). */
  onCancel: () => void
  /** Suggest completions for the current line (slash commands or @-paths). */
  onSuggest: (line: string, cursor: number) => string[]
}

/** Color each row by its presentation kind. */
function colorOf(kind: UiItem['kind']): string | undefined {
  switch (kind) {
    case 'user': return 'cyan'
    case 'reasoning': return 'grey'
    case 'tool': return 'yellow'
    case 'error': return 'red'
    case 'info': return 'grey'
    default: return undefined
  }
}

/** Wrap one row in the optional color. */
function colored(text: string, color: string | undefined): React.ReactNode {
  return color === undefined ? <Text>{text}</Text> : <Text color={color}>{text}</Text>
}

/** Replace the trailing @-word or /-word with the chosen completion. */
function selectSuggestion(line: string, chosen: string): string {
  const at = line.lastIndexOf('@')
  if (at !== -1) return line.slice(0, at + 1) + chosen
  return chosen
}

/** Render one conversation row: rich markdown/diff, or a colored text row. */
function renderRow(item: UiItem): React.ReactNode {
  if (item.kind === 'assistant') return <MarkdownView text={item.text} />
  if (item.kind === 'diff') return <DiffView text={item.text} />
  const color = colorOf(item.kind)
  if (item.kind === 'tool') return colored(`  • ${item.text}`, color)
  if (item.kind === 'user') return colored(`› ${item.text}`, color)
  return colored(item.text, color)
}

/**
 * The terminal app. Reads the store snapshot with `useSyncExternalStore` and
 * owns the input line; key handling routes prompts, submission, completion,
 * and the approval/plan toggles.
 */
export function App({ store, callbacks }: { store: UiStore; callbacks: AppCallbacks }): React.JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const rows = process.stdout.rows ?? 40
  const [input, setInput] = useState('')
  const [promptText, setPromptText] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef('')
  const promptTextRef = useRef('')
  inputRef.current = input
  promptTextRef.current = promptText

  useInput((keyInput, key) => {
    const intent = keyIntent(keyInput, key, state.prompt !== undefined, state.prompt?.choices ?? [])
    switch (intent.type) {
      case 'prompt-submit': {
        const value = promptTextRef.current
        setPromptText('')
        state.prompt?.answer(value)
        break
      }
      case 'prompt-answer':
        if (intent.value === null) setPromptText('')
        state.prompt?.answer(intent.value)
        break
      case 'prompt-text':
        setPromptText(previous => intent.text === '\b' ? previous.slice(0, -1) : previous + intent.text)
        break
      case 'submit': {
        const line = inputRef.current
        setInput('')
        callbacks.onSubmit(line)
        break
      }
      case 'cycle-approval':
        callbacks.onCycleApproval()
        break
      case 'toggle-plan':
        callbacks.onTogglePlan()
        break
      case 'cancel':
        callbacks.onCancel()
        break
      case 'complete': {
        if (suggestions.length > 0) {
          const safeSelected = Math.min(selected, suggestions.length - 1)
          const chosen = suggestions[safeSelected]
          if (chosen !== undefined) setInput(selectSuggestion(inputRef.current, chosen))
        } else {
          const completed = callbacks.onComplete(inputRef.current, inputRef.current.length)
          if (completed !== undefined) setInput(completed)
        }
        break
      }
      case 'suggest-up':
        setSelected(previous => Math.max(0, previous - 1))
        break
      case 'suggest-down':
        setSelected(previous => Math.min(Math.max(0, suggestions.length - 1), previous + 1))
        break
      case 'backspace':
        setInput(previous => previous.slice(0, -1))
        break
      case 'clear':
        setInput('')
        break
      case 'append':
        setInput(previous => previous + intent.text)
        break
      case 'none':
        break
    }
  })

  // Keep the status + input visible; the conversation shows its newest rows.
  const visible = Math.max(0, rows - 3)
  const items = state.items.slice(-visible)
  const suggestions = state.prompt === undefined ? callbacks.onSuggest(input, input.length) : []
  const promptLine = state.prompt === undefined
    ? `> ${input}`
    : state.prompt.choices.length === 0
      ? `${state.prompt.question} ${promptText}`
      : `${state.prompt.question} `

  return (
    <Box flexDirection="column" height={rows}>
      <Box><Text bold>{state.status || 'dsh'}{state.running ? ' …' : ''}</Text></Box>
      <Box flexDirection="column" flexGrow={1}>
        {items.map(item => <Box key={item.key}>{renderRow(item)}</Box>)}
      </Box>
      <Box flexDirection="column">
        {suggestions.length > 0 && (
          <Box flexDirection="column">
            {suggestions.slice(0, 8).map((suggestion, index) => {
              const highlighted = index === Math.min(selected, suggestions.length - 1)
              return highlighted
                ? <Text key={index} bold>{suggestion}</Text>
                : <Text key={index} color="grey">{suggestion}</Text>
            })}
          </Box>
        )}
        <Text>{promptLine}</Text>
      </Box>
    </Box>
  )
}

/**
 * Mount the Ink app and return its instance (for unmount on shutdown).
 * @param store - the UI store to render.
 * @param callbacks - the agent-driver callbacks.
 * @returns the Ink render instance.
 */
export function mountApp(store: UiStore, callbacks: AppCallbacks): ReturnType<typeof render> {
  return render(<App store={store} callbacks={callbacks} />, { exitOnCtrlC: false })
}
