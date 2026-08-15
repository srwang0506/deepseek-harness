import { describe, expect, it } from 'vitest'
import { bashCompletion, zshCompletion } from '../src/completion.ts'

describe('shell completion scripts', () => {
  it('generates a bash script completing the launcher commands', () => {
    const script = bashCompletion()
    expect(script).toContain('complete -F _dsh_completions dsh')
    expect(script).toContain('commands="login model status logout doctor provider providers plugin web exec resume completion help"')
  })

  it('generates a zsh script completing the launcher commands', () => {
    const script = zshCompletion()
    expect(script).toContain('#compdef dsh')
    expect(script).toContain('commands=(login model status logout doctor provider providers plugin web exec resume completion help)')
  })
})
