/**
 * The terminal UI's mutable state: an observable store the agent driver
 * updates and the Ink app renders through `useSyncExternalStore`.
 * @module @deepseek-ai/dsh-tui/ui/store
 */

import type { PromptMode } from './keys.ts'

/** One rendered conversation row. */
export interface UiItem {
  /** Monotonic per-store key. */
  key: number
  /** Presentation kind, used for coloring/layout. */
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'diff' | 'error' | 'info'
  /** Plain text content. */
  text: string
}

/** One selectable session in the resume picker. */
export interface PickerItem {
  /** Session id; resumed on selection. */
  id: string
  /** Latest folded title, when the log carries one. */
  title: string | undefined
  /** The session's working directory, when recorded. */
  cwd: string | undefined
  /** Creation time in epoch milliseconds. */
  createdAt: number
  /** Whether the id currently has a live store entry. */
  live: boolean
}

/** The session picker overlay: an ordered list with one highlighted row. */
export interface UiPicker {
  /** Sessions to choose from, newest first. */
  items: readonly PickerItem[]
  /** Highlighted item index. */
  selected: number
}

/** An approval or question awaiting a terminal answer. */
export type UiPrompt = PromptMode & {
  /** The question line. */
  question: string
  /** The result sink; null means the human dismissed the prompt. */
  answer: (value: string | null) => void
}

/** One previous user message the edit overlay can fork from. */
export interface EditMessageItem {
  /** The message event's seq (its identity in the overlay). */
  seq: number
  /** The message text as submitted. */
  text: string
  /** The fork boundary: seed events through this seq; -1 forks an empty conversation. */
  forkBoundary: number
}

/** One overlay the composer can open over the input area. */
export type UiOverlay =
  | { kind: 'history'; query: string; matches: readonly string[]; selected: number }
  | { kind: 'files'; query: string; matches: readonly string[]; selected: number }
  | { kind: 'edit-message'; items: readonly EditMessageItem[]; selected: number }

/** The two-sided status bar: session facts left, model right (Codex-style). */
export interface StatusInfo {
  /** Left side: sandbox mode, token usage, permission preset, plan mode. */
  left: string
  /** Right side: provider/model, reasoning effort, launch override. */
  right: string
}

/** The whole renderable UI snapshot. */
export interface UiState {
  items: readonly UiItem[]
  status: StatusInfo
  running: boolean
  /** A next-turn message is queued and will run when the current turn settles. */
  queued: boolean
  prompt: UiPrompt | undefined
  picker: UiPicker | undefined
  overlay: UiOverlay | undefined
}

type Listener = () => void

/**
 * A small observable state holder. Every mutation publishes a fresh snapshot
 * and notifies subscribers; the App reads the snapshot with
 * `useSyncExternalStore`.
 */
export class UiStore {
  private state: UiState = { items: [], status: { left: 'dsh', right: '' }, running: false, queued: false, prompt: undefined, picker: undefined, overlay: undefined }
  private listeners = new Set<Listener>()
  private nextKey = 1

  /** Subscribe to snapshot changes; returns the unsubscribe disposer. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The current immutable snapshot, for `useSyncExternalStore`. */
  getSnapshot = (): UiState => this.state

  private publish(next: UiState): void {
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Append one row.
   * @param item - the row content.
   */
  push(item: Omit<UiItem, 'key'>): void {
    this.publish({ ...this.state, items: [...this.state.items, { ...item, key: this.nextKey++ }] })
  }

  /**
   * Append text to the last row of `kind`, or push a fresh row.
   * @param kind - the row kind to extend.
   * @param text - the text delta.
   */
  appendText(kind: UiItem['kind'], text: string): void {
    const items = [...this.state.items]
    const last = items.at(-1)
    if (last !== undefined && last.kind === kind) {
      items[items.length - 1] = { ...last, text: last.text + text }
    } else {
      items.push({ key: this.nextKey++, kind, text })
    }
    this.publish({ ...this.state, items })
  }

  /**
   * Replace the status-bar halves.
   * @param status - the new left/right status text.
   */
  setStatus(status: StatusInfo): void {
    this.publish({ ...this.state, status })
  }

  /**
   * Mark whether the agent is mid-turn.
   * @param running - the new running flag.
   */
  setRunning(running: boolean): void {
    this.publish({ ...this.state, running })
  }

  /**
   * Mark whether a next-turn message is queued.
   * @param queued - the new queued flag.
   */
  setQueued(queued: boolean): void {
    this.publish({ ...this.state, queued })
  }

  /**
   * Set or clear the pending approval/question prompt.
   * @param prompt - the prompt to show, or `undefined` to clear it.
   */
  setPrompt(prompt: UiPrompt | undefined): void {
    this.publish({ ...this.state, prompt })
  }

  /**
   * Set, replace, or clear the session picker overlay.
   * @param picker - the picker snapshot to show, or `undefined` to close it.
   */
  setPicker(picker: UiPicker | undefined): void {
    this.publish({ ...this.state, picker })
  }

  /**
   * Set, replace, or clear the composer overlay (history or file search).
   * @param overlay - the overlay snapshot to show, or `undefined` to close it.
   */
  setOverlay(overlay: UiOverlay | undefined): void {
    this.publish({ ...this.state, overlay })
  }

  /**
   * Resolve the pending prompt with a null dismissal if one is open, so a
   * turn cancellation cannot leave the prompt hanging or its question line on
   * screen.
   */
  dismissPrompt(): void {
    const prompt = this.state.prompt
    if (prompt === undefined) return
    this.publish({ ...this.state, prompt: undefined })
    prompt.answer(null)
  }
}
