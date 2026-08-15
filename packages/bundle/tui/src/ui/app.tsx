/**
 * The Ink terminal app: a full-screen layout (status bar, scrollable
 * conversation, input line) driven by a {@link UiStore} snapshot.
 * @module @deepseek-ai/dsh-tui/ui/app
 */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text, render, useInput } from 'ink'
import type { UiStore, UiItem } from './store.ts'
import { DiffView, MarkdownView } from './rich.tsx'
import { keyIntent, pickerIntent } from './keys.ts'
import type { KeyLike } from './keys.ts'
import { applyComposerKey, emptyEdit } from './composer.ts'
import type { ComposerEdit } from './composer.ts'
import { editOverlayKey, historyRank, openEditOverlay, openFilesOverlay, openHistoryOverlay, overlayKey } from './overlay.ts'
import type { EditMessageItem, StatusAccent, StatusSegment } from './store.ts'

/** Callbacks the app needs from the agent driver. */
export interface AppCallbacks {
  /** Submit one command line. */
  onSubmit: (line: string) => void
  /** Queue one line for the next turn (Tab while a turn runs). */
  onQueue: (line: string) => void
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
  /** Fuzzy-rank the project-file index for one @ search query. */
  searchFiles: (query: string) => string[]
  /** The session's previous user messages, for the edit-and-fork overlay. */
  editMessages: () => readonly EditMessageItem[]
  /** Submit an edited message: the runner forks the session at its boundary first. */
  onSubmitEdit: (line: string, forkBoundary: number) => void
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

/** Map one status accent to its Codex status-line color group. */
function accentColor(accent: StatusAccent): 'cyan' | 'green' | 'magenta' {
  switch (accent) {
    case 'usage': return 'green'
    case 'mode': return 'magenta'
    case 'model':
    case 'metadata':
    default: return 'cyan'
  }
}

/** Render one status-bar side's segments with dim ` · ` separators. */
function statusSpans(segments: readonly StatusSegment[]): React.ReactNode {
  return segments.map((segment, index) => (
    <React.Fragment key={index}>
      {index > 0 ? <Text color="grey" dimColor> · </Text> : null}
      <Text color={accentColor(segment.accent)}>{segment.text}</Text>
    </React.Fragment>
  ))
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
  if (item.kind === 'assistant') return <Box><Text color="grey" dimColor>• </Text><MarkdownView text={item.text} /></Box>
  if (item.kind === 'reasoning') return <Text color="grey" dimColor>{`• ${item.text}`}</Text>
  if (item.kind === 'separator') return <Text color="grey" dimColor>{'─'.repeat(72)}</Text>
  if (item.kind === 'diff') return <DiffView text={item.text} />
  if (item.kind === 'tool') return <Text color="grey" dimColor>{`• ${item.text}`}</Text>
  if (item.kind === 'user') return <Text bold dimColor>{`› ${item.text}`}</Text>
  return colored(item.text, colorOf(item.kind))
}

/**
 * The terminal app. Reads the store snapshot with `useSyncExternalStore` and
 * owns the input line; key handling routes prompts, submission, completion,
 * quitting, and the approval/plan toggles.
 */
export function App({ store, callbacks }: { store: UiStore; callbacks: AppCallbacks }): React.JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // The testing library's fake stdout reports no size at all.
  const rows = (process.stdout as { rows?: number }).rows
  const [edit, setEdit] = useState<ComposerEdit>(emptyEdit)
  const [promptText, setPromptText] = useState('')
  const [selected, setSelected] = useState(0)
  const editRef = useRef<ComposerEdit>(emptyEdit())
  const keyHandlerRef = useRef<(keyInput: string, key: KeyLike) => void>(() => {})
  /** Set while the composer holds a message loaded for edit-and-fork. */
  const editSeqRef = useRef<number | undefined>(undefined)
  /** The fork boundary paired with {@link editSeqRef}. */
  const editBoundaryRef = useRef(-1)
  const promptTextRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  editRef.current = edit
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
      if (entry !== undefined) setEdit({ text: entry, cursor: entry.length, vim: 'insert' })
    } else {
      if (current < 0) return
      const index = current + 1
      if (index >= history.length) {
        historyIndexRef.current = -1
        setEdit(emptyEdit())
      } else {
        historyIndexRef.current = index
        const entry = history[index]
        if (entry !== undefined) setEdit({ text: entry, cursor: entry.length, vim: 'insert' })
      }
    }
  }

  /**
   * Route one parsed key through the open surface (picker, overlay, prompt,
   * composer). Reassigned every render through `keyHandlerRef` so the
   * `useInput` subscription below stays stable: Ink re-subscribes its stdin
   * listener whenever the handler identity changes, and the spinner/stream
   * re-renders would otherwise drop keystrokes in the resubscription gaps.
   */
  function handleKey(keyInput: string, key: KeyLike): void {
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
    if (state.overlay !== undefined) {
      const overlay = state.overlay
      if (overlay.kind === 'edit-message') {
        const next = editOverlayKey(overlay, keyInput, key)
        if (next === undefined) {
          store.setOverlay(undefined)
        } else if ('edit' in next) {
          store.setOverlay(undefined)
          editRef.current = { text: next.edit.text, cursor: next.edit.text.length, vim: 'insert' }
          setEdit(editRef.current)
          editSeqRef.current = next.edit.seq
          editBoundaryRef.current = next.edit.forkBoundary
        } else {
          store.setOverlay(next)
        }
        return
      }
      const rank = overlay.kind === 'history' ? historyRank(historyRef.current) : callbacks.searchFiles
      const next = overlayKey(overlay, keyInput, key, rank)
      if (next === undefined) {
        store.setOverlay(undefined)
      } else if ('insert' in next) {
        store.setOverlay(undefined)
        // A file insert replaces the trailing `@` the overlay opened from.
        const text = overlay.kind === 'history'
          ? next.insert
          : editRef.current.text.slice(0, -1) + '@' + next.insert
        editRef.current = { text, cursor: text.length, vim: 'insert' }
        setEdit(editRef.current)
      } else {
        store.setOverlay(next)
      }
      return
    }
    if (state.prompt !== undefined) {
      const intent = keyIntent(keyInput, key, state.prompt, promptTextRef.current)
      switch (intent.type) {
        case 'prompt-return': {
          const value = promptTextRef.current
          if (state.prompt.kind === 'text' && state.prompt.multiLine
            && value !== '' && !value.endsWith('\n')) {
            setPromptText(value + '\n')
            break
          }
          const text = value.trim()
          setPromptText('')
          state.prompt.answer(text === '' ? null : text)
          break
        }
        case 'prompt-answer':
          if (intent.value === null) setPromptText('')
          state.prompt.answer(intent.value)
          break
        case 'prompt-text':
          setPromptText(previous => intent.text === '\b' ? previous.slice(0, -1) : previous + intent.text)
          break
        case 'cancel':
          callbacks.onCancel()
          break
        default:
          break
      }
      return
    }
    // No prompt: the composer engine owns the key map (Vim motions included).
    const result = applyComposerKey(editRef.current, keyInput, key)
    switch (result.type) {
      case 'edit':
        historyIndexRef.current = -1
        // Eager ref update: same-tick keystrokes must see the fresh state
        // before React re-renders, or the second chunk edits stale text.
        editRef.current = result.next
        setEdit(result.next)
        // A line-start or post-space `@` opens the project-file search.
        if (result.next.vim === 'insert' && /(^|\s)@$/.test(result.next.text)) {
          store.setOverlay(openFilesOverlay(callbacks.searchFiles))
        }
        break
      case 'submit':
      case 'append-and-submit': {
        const line = result.line
        editRef.current = result.next
        setEdit(result.next)
        historyRef.current = [...historyRef.current, line]
        historyIndexRef.current = -1
        const editSeq = editSeqRef.current
        const editBoundary = editBoundaryRef.current
        editSeqRef.current = undefined
        if (editSeq !== undefined) callbacks.onSubmitEdit(line, editBoundary)
        else callbacks.onSubmit(line)
        break
      }
      case 'history-search': {
        const overlay = openHistoryOverlay(historyRef.current)
        if (overlay !== undefined) store.setOverlay(overlay)
        break
      }
      case 'quit':
        callbacks.onQuit()
        break
      case 'cancel':
        callbacks.onCancel()
        break
      case 'complete':
      case 'edit-and-complete': {
        if (result.type === 'edit-and-complete') {
          historyIndexRef.current = -1
          editRef.current = result.next
          setEdit(result.next)
        }
        const current = editRef.current.text
        if (state.running && current.trim() !== '') {
          // Tab while a turn runs queues the line for the next turn (Codex),
          // instead of steering and instead of path completion.
          editRef.current = emptyEdit()
          setEdit(emptyEdit())
          callbacks.onQueue(current)
          break
        }
        let next: string | undefined
        if (suggestions.length > 0) {
          const chosen = suggestions[Math.min(selected, suggestions.length - 1)]
          if (chosen !== undefined) next = selectSuggestion(current, chosen)
        } else {
          next = callbacks.onComplete(current, current.length)
        }
        if (next !== undefined) {
          historyIndexRef.current = -1
          editRef.current = { text: next, cursor: next.length, vim: 'insert' }
          setEdit(editRef.current)
        }
        break
      }
      case 'cycle-approval':
        callbacks.onCycleApproval()
        break
      case 'toggle-plan':
        callbacks.onTogglePlan()
        break
      case 'suggest-up':
        if (suggestions.length > 0) setSelected(previous => Math.max(0, previous - 1))
        else if (editRef.current.text === '') {
          // ↑ on an empty composer enters Codex's edit-previous-message mode.
          const overlay = openEditOverlay(callbacks.editMessages())
          if (overlay !== undefined) store.setOverlay(overlay)
        } else recallHistory(-1)
        break
      case 'suggest-down':
        if (suggestions.length > 0) setSelected(previous => Math.min(Math.max(0, suggestions.length - 1), previous + 1))
        else recallHistory(1)
        break
      case 'none':
        break
    }
  }
  keyHandlerRef.current = handleKey
  const stableHandleInput = useCallback((keyInput: string, key: KeyLike): void => {
    keyHandlerRef.current(keyInput, key)
  }, [])
  useInput(stableHandleInput)

  // Keep the composer + status visible; the conversation shows its newest rows.
  const picker = state.picker
  const overlay = state.overlay
  const suggestions = state.prompt === undefined && picker === undefined && overlay === undefined
    ? callbacks.onSuggest(edit.text, edit.cursor)
    : []
  const pickerRows = picker === undefined ? 0 : 2 + Math.min(picker.items.length, 12)
  const overlayRows = overlay === undefined
    ? 0
    : 2 + Math.min(overlay.kind === 'edit-message' ? overlay.items.length : overlay.matches.length, 8)
  const composerRows = state.prompt === undefined ? Math.max(1, edit.text.split('\n').length) : 1
  // The conversation slice is budgeted by rendered LINES, not items: one
  // streamed assistant row can be dozens of lines tall, and an item-count
  // slice would let it overflow the flex area and clip the composer and the
  // status bar out of the fixed-height frame.
  const budget = rows === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, rows - composerRows - 1 - Math.min(suggestions.length, 8) - pickerRows - overlayRows)
  const items: UiItem[] = []
  let lineBudget = budget
  for (let index = state.items.length - 1; index >= 0 && lineBudget > 0; index -= 1) {
    const item = state.items[index]
    if (item === undefined) continue
    const lines = item.text.split('\n')
    if (lines.length > lineBudget) {
      // A row taller than the whole budget (a long streamed response) shows
      // its newest lines — the tail IS the live content.
      items.unshift({ ...item, text: lines.slice(-lineBudget).join('\n') })
      lineBudget = 0
    } else {
      items.unshift(item)
      lineBudget -= lines.length
    }
  }
  const promptLine = state.prompt === undefined
    ? undefined
    : state.prompt.kind === 'choice'
      ? state.prompt.question
      : `${state.prompt.question} ${promptText}`
  const status = state.status
  const cursorAt = edit.text.charAt(edit.cursor)
  const cursorChar = cursorAt === '' || cursorAt === '\n' ? '█' : cursorAt
  const cursorBefore = edit.text.slice(0, edit.cursor)
  const cursorAfter = edit.text.slice(edit.cursor + 1)

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
          {overlay !== undefined && overlay.kind === 'edit-message' && (
            <Box flexDirection="column">
              <Box><Text bold>edit message — ↑/↓ select · Enter edit · Esc cancel</Text></Box>
              {overlay.items.map((item, index) => {
                const label = item.text.length > 78 ? `${item.text.slice(0, 78)}…` : item.text
                return index === overlay.selected
                  ? <Box key={item.seq}><Text bold>{`› ${label}`}</Text></Box>
                  : <Box key={item.seq}><Text color="grey">{`  ${label}`}</Text></Box>
              })}
            </Box>
          )}
          {overlay !== undefined && overlay.kind !== 'edit-message' && (
            <Box flexDirection="column">
              <Box><Text bold>{overlay.kind === 'history' ? `history search: ${overlay.query}` : `file search: ${overlay.query}`} — ↑/↓ select · Enter reuse · Esc cancel</Text></Box>
              {overlay.matches.map((match, index) => index === overlay.selected
                ? <Box key={index}><Text bold>{`› ${match}`}</Text></Box>
                : <Box key={index}><Text color="grey">{`  ${match}`}</Text></Box>)}
            </Box>
          )}
          {state.prompt === undefined
            ? (
              <Box><Text>
                {cursorBefore}
                <Text inverse>{cursorChar}</Text>
                {cursorAfter}
              </Text></Box>
            )
            : <Box><Text>{promptLine ?? ''}</Text></Box>}
          <Box>
            <Box>
              {state.queued ? <Text color="magenta">{'⇥ queued'}</Text> : null}
              {state.queued ? <Text color="grey" dimColor> · </Text> : null}
              {spinner === '' ? null : <Text color="grey" dimColor>{`${spinner} `}</Text>}
              {statusSpans(status.left)}
            </Box>
            <Box flexGrow={1} />
            <Box>{statusSpans(status.right)}</Box>
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
