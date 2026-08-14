import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { TerminalInput } from '../src/input.ts'

function makeInput(onWrite?: (text: string) => void): { terminal: TerminalInput; input: PassThrough } {
  const input = new PassThrough()
  const output = { write: (text: string) => { onWrite?.(text); return true } }
  return { terminal: new TerminalInput({ input, output }), input }
}

describe('TerminalInput', () => {
  it('reads a command line submitted with Enter', async () => {
    const { terminal, input } = makeInput()
    terminal.start()
    const promise = terminal.readCommand()
    input.write('hello')
    input.write('\r')
    await expect(promise).resolves.toBe('hello')
    terminal.stop()
  })

  it('recalls history with the up arrow', async () => {
    const { terminal, input } = makeInput()
    terminal.start()
    const first = terminal.readCommand()
    input.write('one')
    input.write('\r')
    await expect(first).resolves.toBe('one')

    const second = terminal.readCommand()
    input.write('\u001b[A')
    input.write('\r')
    await expect(second).resolves.toBe('one')
    terminal.stop()
  })

  it('returns the chosen key from readChoice', async () => {
    const { terminal, input } = makeInput()
    terminal.start()
    const promise = terminal.readChoice('Allow? [y/N]', ['y', 'n'])
    input.write('y')
    await expect(promise).resolves.toBe('y')
    terminal.stop()
  })

  it('returns null on EOF of an empty command line', async () => {
    const { terminal, input } = makeInput()
    terminal.start()
    const promise = terminal.readCommand()
    input.write('\u0004')
    await expect(promise).resolves.toBeNull()
    terminal.stop()
  })

  it('treats a multi-line paste as one command', async () => {
    const { terminal, input } = makeInput()
    terminal.start()
    const promise = terminal.readCommand()
    input.write('hello\nworld\n')
    await expect(promise).resolves.toBe('hello\nworld')
    terminal.stop()
  })

  it('completes the buffer via the Tab callback', async () => {
    const input = new PassThrough()
    const terminal = new TerminalInput({ input, output: { write: () => true }, onComplete: () => 'completion' })
    terminal.start()
    const promise = terminal.readCommand()
    input.write('\t')
    input.write('\r')
    await expect(promise).resolves.toBe('completion')
    terminal.stop()
  })

  it('emits Shift+Tab and Ctrl+P callbacks while editing', async () => {
    let cycled = 0
    let toggled = 0
    const input = new PassThrough()
    const terminal = new TerminalInput({
      input,
      output: { write: () => true },
      onCycleApproval: () => { cycled += 1 },
      onTogglePlan: () => { toggled += 1 },
    })
    terminal.start()
    const promise = terminal.readCommand()
    input.write('\u001b[Z')
    input.write('\u0016')
    input.write('\r')
    await promise
    expect(cycled).toBe(1)
    expect(toggled).toBe(1)
    terminal.stop()
  })
})
