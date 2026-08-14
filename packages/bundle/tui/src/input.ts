/**
 * Raw-mode terminal input for the interactive loop: line editing, command
 * history, paste, and single-key choices. One read is in flight at a time —
 * the runner awaits a command line only while the agent is idle, and answers
 * approvals/questions with `readChoice` while the agent is running.
 * @module @deepseek-ai/dsh-tui/input
 */

import { StringDecoder } from 'node:string_decoder'

/** The stream/stdio pair the reader drives. */
export interface TerminalInputOptions {
  input: NodeJS.ReadableStream & { setRawMode?: (mode: boolean) => unknown }
  output: { write(chunk: string): unknown }
  /** Called on Ctrl+C while no command or choice read is in flight (agent running). */
  onInterrupt?: () => void
  /** Called on Ctrl+D on an empty command line; the reader stays open for the caller to quit. */
  onEof?: () => void
  /** Called on Shift+Tab while editing a command (cycle the permission preset). */
  onCycleApproval?: () => void
  /** Called on Ctrl+P while editing a command (toggle plan mode). */
  onTogglePlan?: () => void
  /** Called on Tab; return a replacement line to complete, or undefined. */
  onComplete?: (buffer: string, cursor: number) => string | undefined
}

/** The in-flight read's kind. */
type Mode = 'idle' | 'command' | 'choice'

/** The prompt shown while editing a command line. */
const PROMPT = '> '

/**
 * A minimal raw-mode line editor. It owns stdin's raw flag and echoes the
 * current line itself; `readCommand` returns completed lines and `readChoice`
 * returns one of the offered keys.
 */
export class TerminalInput {
  private readonly input: NodeJS.ReadableStream & { setRawMode?: (mode: boolean) => unknown }
  private readonly output: TerminalInputOptions['output']
  private readonly onInterrupt: (() => void) | undefined
  private readonly onEof: (() => void) | undefined
  private readonly onCycleApproval: (() => void) | undefined
  private readonly onTogglePlan: (() => void) | undefined
  private readonly onComplete: ((buffer: string, cursor: number) => string | undefined) | undefined
  private readonly decoder = new StringDecoder('utf8')
  private started = false
  private mode: Mode = 'idle'
  private buffer = ''
  private cursor = 0
  private prompt = PROMPT
  private history: string[] = []
  private historyIndex = -1
  private commandResolver: ((line: string | null) => void) | undefined
  private choiceResolver: ((key: string | null) => void) | undefined
  private choices: readonly string[] = []
  private escape = ''

  constructor(options: TerminalInputOptions) {
    this.input = options.input
    this.output = options.output
    this.onInterrupt = options.onInterrupt
    this.onEof = options.onEof
    this.onCycleApproval = options.onCycleApproval
    this.onTogglePlan = options.onTogglePlan
    this.onComplete = options.onComplete
  }

  /** Put stdin in raw mode and begin decoding key input. */
  start(): void {
    if (this.started) return
    this.started = true
    this.input.setRawMode?.(true)
    this.input.on('data', this.handleData)
  }

  /** Restore cooked mode and detach the data listener. */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.input.setRawMode?.(false)
    this.input.off('data', this.handleData)
  }

  /**
   * Read one command line until Enter (or EOF on an empty line).
   * @param prompt - the prompt shown while editing (defaults to `'> '`).
   * @returns the line without its newline, or `null` on EOF.
   */
  readCommand(prompt: string = PROMPT): Promise<string | null> {
    return new Promise((resolve) => {
      this.commandResolver = resolve
      this.mode = 'command'
      this.prompt = prompt
      this.buffer = ''
      this.cursor = 0
      this.historyIndex = -1
      this.redraw()
    })
  }

  /**
   * Read one key from `choices`, prompting with `prompt`.
   * @param prompt - the question line (plain text).
   * @param choices - accepted single-character keys (plus Enter).
   * @returns the chosen key (`\r` for Enter), or `null` on Escape.
   */
  readChoice(prompt: string, choices: readonly string[]): Promise<string | null> {
    return new Promise((resolve) => {
      this.choiceResolver = resolve
      this.choices = choices
      this.mode = 'choice'
      this.write(`\n${prompt} `)
    })
  }

  /** Whether a read is currently waiting. */
  get busy(): boolean {
    return this.mode !== 'idle'
  }

  private readonly handleData = (chunk: Buffer): void => {
    const text = this.decoder.write(chunk)
    // A paste arrives as one data event carrying embedded newlines; treat the
    // whole span as one multi-line command instead of submitting at the first
    // newline (which would drop the rest and re-submit each line separately).
    if (this.mode === 'command' && text.length > 1 && /[\r\n]/.test(text)) {
      this.handlePaste(text)
      return
    }
    for (const char of text) this.handleChar(char)
  }

  private handlePaste(text: string): void {
    const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    const content = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
    if (content === '') return
    this.buffer = content
    this.cursor = content.length
    // Echo the pasted block, then submit it as one command.
    this.write(content)
    this.submit()
  }

  private handleChar(char: string): void {
    if (this.mode === 'choice') {
      this.handleChoiceKey(char)
      return
    }
    if (this.escape !== '') {
      this.escape += char
      this.tryEscape()
      return
    }
    if (char === '\u001b') {
      this.escape = char
      return
    }
    if (this.mode === 'command') {
      this.handleCommandKey(char)
      return
    }
    // Idle: Ctrl+C interrupts a running agent; anything else is discarded.
    if (char === '\u0003') this.onInterrupt?.()
  }

  private handleChoiceKey(char: string): void {
    if (char === '\u001b') {
      const resolve = this.choiceResolver
      this.mode = 'idle'
      this.choiceResolver = undefined
      this.write('\n')
      resolve?.(null)
      return
    }
    const key = char === '\r' || char === '\n' ? '\r' : char
    if (char === '\r' || char === '\n' || this.choices.includes(char)) {
      const resolve = this.choiceResolver
      this.mode = 'idle'
      this.choiceResolver = undefined
      this.write('\n')
      resolve?.(key)
    }
  }

  private handleCommandKey(char: string): void {
    switch (char) {
      case '\r':
      case '\n':
        this.submit()
        return
      case '\u0003': {
        // Ctrl+C clears the line and re-prompts.
        this.buffer = ''
        this.cursor = 0
        this.historyIndex = -1
        this.redraw()
        return
      }
      case '\u0004': {
        if (this.buffer === '') {
          const resolve = this.commandResolver
          this.mode = 'idle'
          this.commandResolver = undefined
          this.write('\n')
          resolve?.(null)
          this.onEof?.()
        }
        return
      }
      case '\u007f':
      case '\u0008':
        this.backspace()
        return
      case '\u0001':
        this.cursor = 0
        this.redraw()
        return
      case '\u0005':
        this.cursor = this.buffer.length
        this.redraw()
        return
      case '\u000b':
        this.buffer = this.buffer.slice(0, this.cursor)
        this.redraw()
        return
      case '\u0015':
        this.buffer = this.buffer.slice(this.cursor)
        this.cursor = 0
        this.redraw()
        return
      case '\u0017':
        this.killWord()
        return
      case '\u0016':
        this.onTogglePlan?.()
        return
      case '\t': {
        const completed = this.onComplete?.(this.buffer, this.cursor)
        if (completed !== undefined) {
          this.buffer = completed
          this.cursor = completed.length
          this.redraw()
        }
        return
      }
      default:
        this.insert(char)
    }
  }

  private tryEscape(): void {
    if (this.escape === '\u001b['
      || this.escape === '\u001b[1'
      || this.escape === '\u001b[2'
      || this.escape === '\u001b[3'
      || this.escape === '\u001b[4'
      || this.escape === '\u001b[O') {
      return
    }
    const arrow = this.escape === '\u001b[A' ? 'up'
      : this.escape === '\u001b[B' ? 'down'
        : this.escape === '\u001b[C' ? 'right'
          : this.escape === '\u001b[D' ? 'left'
            : this.escape === '\u001b[Z' ? 'shifttab'
              : this.escape === '\u001b[H' ? 'home'
                : this.escape === '\u001b[F' ? 'end'
                  : this.escape === '\u001b[1~' ? 'home'
                    : this.escape === '\u001b[4~' ? 'end'
                      : this.escape === '\u001b[3~' ? 'delete'
                        : undefined
    this.escape = ''
    if (arrow === undefined) return
    if (arrow === 'shifttab') {
      this.onCycleApproval?.()
      return
    }
    switch (arrow) {
      case 'up': this.historyPrev(); break
      case 'down': this.historyNext(); break
      case 'left': this.cursor = Math.max(0, this.cursor - 1); this.redraw(); break
      case 'right': this.cursor = Math.min(this.buffer.length, this.cursor + 1); this.redraw(); break
      case 'home': this.cursor = 0; this.redraw(); break
      case 'end': this.cursor = this.buffer.length; this.redraw(); break
      case 'delete': this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1); this.redraw(); break
      default: break
    }
  }

  private historyPrev(): void {
    if (this.history.length === 0) return
    if (this.historyIndex === -1) this.historyIndex = this.history.length - 1
    else this.historyIndex = Math.max(0, this.historyIndex - 1)
    const entry = this.history[this.historyIndex]
    if (entry === undefined) return
    this.buffer = entry
    this.cursor = entry.length
    this.redraw()
  }

  private historyNext(): void {
    if (this.historyIndex === -1) return
    this.historyIndex += 1
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = -1
      this.buffer = ''
    } else {
      const entry = this.history[this.historyIndex]
      if (entry === undefined) return
      this.buffer = entry
    }
    this.cursor = this.buffer.length
    this.redraw()
  }

  private insert(char: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + char + this.buffer.slice(this.cursor)
    this.cursor += 1
    this.redraw()
  }

  private backspace(): void {
    if (this.cursor === 0) return
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor)
    this.cursor -= 1
    this.redraw()
  }

  private killWord(): void {
    const before = this.buffer.slice(0, this.cursor)
    const match = /\S+\s*$/.exec(before)
    const cut = match === null ? before : before.slice(0, before.length - match[0].length)
    this.buffer = cut + this.buffer.slice(this.cursor)
    this.cursor = cut.length
    this.redraw()
  }

  private submit(): void {
    const line = this.buffer
    if (line !== '' && this.history.at(-1) !== line) this.history.push(line)
    const resolve = this.commandResolver
    this.mode = 'idle'
    this.commandResolver = undefined
    this.write('\n')
    resolve?.(line)
  }

  private redraw(): void {
    this.write(`\r\u001b[2K${this.prompt}${this.buffer}`)
    const back = this.buffer.length - this.cursor
    if (back > 0) this.write(`\u001b[${back}D`)
  }

  private write(text: string): void {
    this.output.write(text)
  }
}
