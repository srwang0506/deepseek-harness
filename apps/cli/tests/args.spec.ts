import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'

const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseDshArgs', () => {
  it('routes profile boots and the web alias, handing the rest to the app', () => {
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    expect(parse(['web'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: [] })
    expect(parse(['web', '--patch', 'web.yml']))
      .toEqual({ mode: 'profile', profile: 'web', patches: ['web.yml'], args: [] })
  })

  it('defaults to the tui terminal profile when no --profile is given', () => {
    expect(parse([])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['run', 'the', 'tests'] })
    expect(parse(['--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: [] })
  })

  it('ends the launcher flags at the first token it does not own', () => {
    // App flags, including its -h, and positionals reach the app verbatim.
    expect(parse(['--profile', 'tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'web', '-h']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['-h'] })
    expect(parse(['web', '--host', '127.0.0.1', '--port', '8080', '--dev']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--host', '127.0.0.1', '--port', '8080', '--dev'] })
    expect(parse(['--profile', 'headless', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['run', 'the', 'tests'] })
    // Launcher flags placed after that boundary belong to the app too.
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--resume', 'b', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['--resume', 'b', '--patch', 'late.yml'] })
  })

  it('routes the exec one-shot subcommand into the tui profile', () => {
    expect(parse(['exec', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['run', 'the', 'tests'] })
    expect(parse(['exec', '--json', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--json', 'run', 'the', 'tests'] })
    expect(parse(['exec', '--patch', 'a.yml', 'hi']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['hi'] })
    expect(parse(['exec', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: [] })
    expect(parse(['exec']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--stdin-task'] })
  })

  it('routes the resume subcommand into the tui profile', () => {
    expect(parse(['resume']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume-picker'] })
    expect(parse(['resume', '--last']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--continue'] })
    expect(parse(['resume', '-l']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--continue'] })
    expect(parse(['resume', 'session-abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'session-abc'] })
    expect(() => parse(['resume', 'session-abc', '--last'])).toThrow()
    expect(exitCode(['resume', 'session-abc', '--last'])).toBe(1)
  })

  it('routes the plugin pnpm forwarder', () => {
    expect(parse(['plugin', '--profile', 'tui', 'add', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'remove', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['remove', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'why', '@deepseek-ai/cordis']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['why', '@deepseek-ai/cordis'] })
    // Unknown pnpm flags forward verbatim.
    expect(parse(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })

  it('routes the OpenAI GPT login, model, status, and logout commands', () => {
    expect(parse(['login'])).toEqual({ mode: 'login', method: undefined })
    expect(parse(['login', 'browser'])).toEqual({ mode: 'login', method: 'browser' })
    expect(parse(['login', 'device'])).toEqual({ mode: 'login', method: 'device' })
    expect(parse(['login', 'api-key'])).toEqual({ mode: 'login', method: 'api-key' })
    expect(parse(['model'])).toEqual({ mode: 'model', args: [] })
    expect(parse(['model', 'gpt', 'gpt-5.6-sol', 'xhigh'])).toEqual({ mode: 'model', args: ['gpt', 'gpt-5.6-sol', 'xhigh'] })
    expect(parse(['model', 'deepseek'])).toEqual({ mode: 'model', args: ['deepseek'] })
    expect(parse(['status'])).toEqual({ mode: 'status' })
    expect(parse(['logout'])).toEqual({ mode: 'logout' })
    expect(parse(['doctor'])).toEqual({ mode: 'doctor' })
    expect(parse(['completion'])).toEqual({ mode: 'completion', shell: undefined })
    expect(parse(['completion', 'zsh'])).toEqual({ mode: 'completion', shell: 'zsh' })
    expect(parse(['update'])).toEqual({ mode: 'update' })
  })

  it('routes the pi-ai provider management commands', () => {
    expect(parse(['providers'])).toEqual({ mode: 'provider', action: 'list', name: '' })
    expect(parse(['provider', 'add', 'anthropic', '--api-key-env', 'ANTHROPIC_API_KEY']))
      .toEqual({ mode: 'provider', action: 'add', name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' })
    expect(parse(['provider', 'add', 'gateway', '--api-key-env', 'K', '--base-url', 'https://g.example/v1', '--model', 'm']))
      .toEqual({ mode: 'provider', action: 'add', name: 'gateway', apiKeyEnv: 'K', baseURL: 'https://g.example/v1', model: 'm' })
    expect(parse(['provider', 'remove', 'anthropic']))
      .toEqual({ mode: 'provider', action: 'remove', name: 'anthropic' })
  })

  it('routes the MCP server management commands', () => {
    expect(parse(['mcp', 'list'])).toEqual({ mode: 'mcp', action: 'list', name: '', args: [] })
    expect(parse(['mcp', 'add', 'github', '--command', 'npx', '--arg', '-y']))
      .toEqual({ mode: 'mcp', action: 'add', name: 'github', command: 'npx', args: ['-y'] })
    expect(parse(['mcp', 'add', 'fetch', '--url', 'https://m.example.com']))
      .toEqual({ mode: 'mcp', action: 'add', name: 'fetch', args: [], url: 'https://m.example.com' })
    expect(parse(['mcp', 'remove', 'github']))
      .toEqual({ mode: 'mcp', action: 'remove', name: 'github', args: [] })
  })

  it('routes profile and web config dumps', () => {
    expect(parse(['--profile', 'web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: ['x.yml'] })
    expect(parse(['web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
  })

  it('rejects contradictory or malformed inputs', () => {
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-default-config', '--patch', 'p.yml'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['web', '--dump-default-config', '--patch', 'w.yml'])).toBe(1)
    expect(exitCode(['web', '--patch='])).toBe(1)
    // A dump never runs app command-line providers, so it cannot show what
    // those flags would decide; printing a tree that differs from the same
    // invocation's boot would mislead.
    expect(exitCode(['web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['--profile', 'web', '--dump-config', '-h'])).toBe(1)
    expect(exitCode(['plugin', 'add', 'x'])).toBe(1) // --profile required
    expect(exitCode(['plugin', '--profile', 'tui'])).toBe(1) // nothing to forward
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'plugin', 'add', 'y'])).toBe(1)
  })

  it('keeps its own help for an invocation with no app to hand it to', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
