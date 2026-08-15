/**
 * The Ink terminal app: a full-screen layout (status bar, scrollable
 * conversation, input line) driven by a {@link UiStore} snapshot.
 * @module @deepseek-ai/dsh-tui/ui/app
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text, render, useInput } from 'ink'
import type { UiStore, UiItem } from './store.ts'
import { DiffView, MarkdownView } from './rich.tsx'
import { keyIntent, pickerIntent } from './keys.ts'

/** Callbacks the app needs from the agent driver. */
export interface AppCallbacks {
  /** Submit one command line. */
  onSubmit: (line: string) => void
  /** Quit and flush (Ctrl+D, /quit, /exit). */
  onQuit: () => void
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
  /** Resume the session highlighted in the picker. */
  onPickerSelect: (id: string) => void
  /** Fork the session highlighted in the picker and adopt the child. */
  onPickerFork: (id: string) => void
  /** Close the picker without adopting anything. */
  onPickerCancel: () => void
}

/** Braille spinner frames for the running-turn indicator. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇']

/** Color each row by its presentation kind. */
function colorOf(kind: UiItem['kind']): string | undefined {
  switch (kind) {
    case 'reasoning': return 'grey'
    case 'tool': return 'grey'
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
  if (item.kind === 'tool') return <Text color="grey">{`⏺ ${item.text}`}</Text>
  if (item.kind === 'user') return <Text color="grey">{`⏺ ${item.text}`}</Text>
  return colored(item.text, colorOf(item.kind))
}

/**
 * The terminal app. Reads the store snapshot with `useSyncExternalStore` and
 * owns the input line; key handling routes prompts, submission, completion,
 * quitting, and the approval/plan toggles.
 */
export function App({ store, callbacks }: { store: UiStore; callbacks: AppCallbacks }): React.JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const rows = process.stdout.rows
  const [input, setInput] = useState('')
  const [promptText, setPromptText] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef('')
  const promptTextRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  inputRef.current = input
  promptTextRef.current = promptText

  /** The running-turn spinner frame (Codex's braille spinner), advanced by a timer only while running. */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!state.running) {
      setTick(0)
      return
    }
    function advance(): void {
      setTick(previous => previous + 1)
    }
    const timer = setInterval(advance, 100)
    return () => { clearInterval(timer) }
  }, [state.running])
  const spinner = state.running ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length] : ''

  /** Move the input through previously submitted lines; -1 means not browsing. */
  const recallHistory = (step: -1 | 1): void => {
    const history = historyRef.current
    const current = historyIndexRef.current
    if (step < 0) {
      if (history.length === 0) return
      const index = current < 0 ? history.length - 1 : Math.max(0, current - 1)
      historyIndexRef.current = index
      const entry = history[index]
      if (entry !== undefined) setInput(entry)
    } else {
      if (current < 0) return
      const index = current + 1
      if (index >= history.length) {
        historyIndexRef.current = -1
        setInput('')
      } else {
        historyIndexRef.current = index
        const entry = history[index]
        if (entry !== undefined) setInput(entry)
      }
    }
  }

  useInput((keyInput, key) => {
    if (state.picker !== undefined) {
      const picker = pickerIntent(keyInput, key)
      switch (picker.type) {
        case 'picker-up': {
          const length = state.picker.items.length
          store.setPicker({ ...state.picker, selected: (state.picker.selected - 1 + length) % length })
          break
        }
        case 'picker-down':
          store.setPicker({ ...state.picker, selected: (state.picker.selected + 1) % state.picker.items.length })
          break
        case 'picker-select': {
          const chosen = state.picker.items[state.picker.selected]
          if (chosen !== undefined) callbacks.onPickerSelect(chosen.id)
          break
        }
        case 'picker-fork': {
          const chosen = state.picker.items[state.picker.selected]
          if (chosen !== undefined) callbacks.onPickerFork(chosen.id)
          break
        }
        case 'picker-cancel':
          callbacks.onPickerCancel()
          break
        case 'none':
          break
      }
      return
    }
    const intent = keyIntent(keyInput, key, state.prompt, promptTextRef.current)
    switch (intent.type) {
      case 'prompt-return': {
        const value = promptTextRef.current
        if (state.prompt?.kind === 'text' && state.prompt.multiLine
          && value !== '' && !value.endsWith('\n')) {
          setPromptText(value + '\n')
          break
        }
        const text = value.trim()
        setPromptText('')
        state.prompt?.answer(text === '' ? null : text)
        break
      }
      case 'prompt-answer':
        if (intent.value === null) setPromptText('')
        state.prompt?.answer(intent.value)
        break
      case 'prompt-text':
        setPromptText(previous => intent.text === '\b' ? previous.slice(0, -1) : previous + intent.text)
        break
      case 'quit':
        callbacks.onQuit()
        break
      case 'submit': {
        const line = inputRef.current
        setInput('')
        historyRef.current = [...historyRef.current, line]
        historyIndexRef.current = -1
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
        if (suggestions.length > 0) setSelected(previous => Math.max(0, previous - 1))
        else recallHistory(-1)
        break
      case 'suggest-down':
        if (suggestions.length > 0) setSelected(previous => Math.min(Math.max(0, suggestions.length - 1), previous + 1))
        else recallHistory(1)
        break
      case 'backspace':
        historyIndexRef.current = -1
        setInput(previous => previous.slice(0, -1))
        break
      case 'clear':
        historyIndexRef.current = -1
        setInput('')
        break
      case 'append':
        historyIndexRef.current = -1
        setInput(previous => previous + intent.text)
        break
      case 'append-and-submit': {
        const line = inputRef.current + intent.text
        setInput('')
        historyRef.current = [...historyRef.current, line]
        historyIndexRef.current = -1
        callbacks.onSubmit(line)
        break
      }
      case 'none':
        break
    }
  })

  // Keep the composer + status visible; the conversation shows its newest rows.
  const picker = state.picker
  const suggestions = state.prompt === undefined && picker === undefined ? callbacks.onSuggest(input, input.length) : []
  const pickerRows = picker === undefined ? 0 : 2 + Math.min(picker.items.length, 12)
  const visible = Math.max(0, rows - 2 - Math.min(suggestions.length, 8) - pickerRows)
  const items = state.items.slice(-visible)
  const promptLine = state.prompt === undefined
    ? input
    : state.prompt.kind === 'choice'
      ? state.prompt.question
      : `${state.prompt.question} ${promptText}`
  const status = state.status

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexDirection="column" flexGrow={1}>
        {items.map(item => <Box key={item.key}>{renderRow(item)}</Box>)}
      </Box>
      {picker !== undefined && (
        <Box flexDirection="column" borderStyle="round" borderColor="grey">
          <Box><Text bold>Resume session — ↑/↓ select · Enter resume · f fork · Esc cancel</Text></Box>
          {picker.items.map((item, index) => {
            const when = new Date(item.createdAt).toLocaleString()
            const where = item.cwd === undefined ? '' : `  ${item.cwd}`
            const label = `${index + 1}. ${item.title ?? item.id}${item.live ? ' (live)' : ''}  ${when}${where}`
            return index === picker.selected
              ? <Box key={item.id}><Text bold>{`› ${label}`}</Text></Box>
              : <Box key={item.id}><Text color="grey">{`  ${label}`}</Text></Box>
          })}
        </Box>
      )}
      {picker === undefined && (
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
          <Box><Text>{promptLine}</Text></Box>
          <Box>
            <Text color="grey" dimColor>{`${spinner === '' ? '' : `${spinner} `}${status.left === '' ? 'dsh' : status.left}`}</Text>
            <Box flexGrow={1} />
            <Text color="grey" dimColor>{status.right}</Text>
          </Box>
        </Box>
      )}
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
