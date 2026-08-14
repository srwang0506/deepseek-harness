/**
 * The terminal UI's mutable state: an observable store the agent driver
 * updates and the Ink app renders through `useSyncExternalStore`.
 * @module @deepseek-ai/dsh-tui/ui/store
 */

/** One rendered conversation row. */
export interface UiItem {
  /** Monotonic per-store key. */
  key: number
  /** Presentation kind, used for coloring/layout. */
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'diff' | 'error' | 'info'
  /** Plain text content. */
  text: string
}

/** An approval or question awaiting a terminal answer. */
export interface UiPrompt {
  /** The question line. */
  question: string
  /** Accepted single-character keys (plus Enter). */
  choices: readonly string[]
  /** The result sink. */
  answer: (key: string | null) => void
}

/** The whole renderable UI snapshot. */
export interface UiState {
  items: readonly UiItem[]
  status: string
  running: boolean
  prompt: UiPrompt | undefined
}

type Listener = () => void

/**
 * A small observable state holder. Every mutation publishes a fresh snapshot
 * and notifies subscribers; the App reads the snapshot with
 * `useSyncExternalStore`.
 */
export class UiStore {
  private state: UiState = { items: [], status: '', running: false, prompt: undefined }
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
   * Replace the status-bar text.
   * @param status - the new status text.
   */
  setStatus(status: string): void {
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
   * Set or clear the pending approval/question prompt.
   * @param prompt - the prompt to show, or `undefined` to clear it.
   */
  setPrompt(prompt: UiPrompt | undefined): void {
    this.publish({ ...this.state, prompt })
  }
}
