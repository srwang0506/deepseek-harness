/**
 * The terminal app's ordinary command-line provider over a real Loader tree:
 * the task, resume id, continue flag, and model become injected runner config,
 * while help and usage errors leave the consumer pending.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'

interface Observed {
  exits: number[]
  out: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

async function bootStartup(args: string[]): Promise<{ startup: TuiStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__tuiStartupObserved.runnerConfig = config }\n')
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: tui-runner',
    `  name: ${rowUrl}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    '    task: !!js ctx.tuiStartup.task ?? \'\'',
    '    resumeSessionId: !!js ctx.tuiStartup.resumeSessionId ?? \'\'',
    '    continue: !!js ctx.tuiStartup.continue ?? false',
    '    model: !!js ctx.tuiStartup.model ?? \'\'',
    '    output: !!js ctx.tuiStartup.output ?? \'text\'',
    '    images: !!js ctx.tuiStartup.images ?? []',
    '- id: tui-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __tuiStartupApply: typeof apply
    __tuiStartupObserved: Observed
  }
  globals.__tuiStartupApply = apply
  globals.__tuiStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    startup: ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined,
    observed,
  }
}

describe('tui command-line provider', () => {
  it('publishes the parsed invocation to the runner', async () => {
    const { startup, observed } = await bootStartup(['run', 'the', 'tests'])
    expect(startup).toEqual({ task: 'run the tests', resumeSessionId: '', continue: false, model: '', output: 'text', images: [] })
    expect(observed.runnerConfig).toEqual({ task: 'run the tests', resumeSessionId: '', continue: false, model: '', output: 'text', images: [] })
    expect(observed.exits).toEqual([])
  })

  it('publishes the resume and model flags', async () => {
    const { startup } = await bootStartup(['--resume', 'abc', '-m', 'deepseek-chat'])
    expect(startup).toEqual({ task: '', resumeSessionId: 'abc', continue: false, model: 'deepseek-chat', output: 'text', images: [] })
  })

  it('publishes the json and jsonl output flags', async () => {
    const json = await bootStartup(['--json', 'run', 'tests'])
    expect(json.startup?.output).toBe('json')
    const jsonl = await bootStartup(['--jsonl', 'run', 'tests'])
    expect(jsonl.startup?.output).toBe('jsonl')
  })

  it('publishes the repeatable image flags', async () => {
    const { startup } = await bootStartup(['-i', 'a.png', '-i', 'b.jpg', 'run'])
    expect(startup?.images).toEqual(['a.png', 'b.jpg'])
  })

  it('rejects --json with --jsonl', async () => {
    const { startup, observed } = await bootStartup(['--json', '--jsonl', 'run'])
    expect(observed.out).toContain('mutually exclusive')
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects --resume with --continue', async () => {
    const { startup, observed } = await bootStartup(['--resume', 'abc', '--continue'])
    expect(observed.out).toContain('mutually exclusive')
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { startup, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('Usage: dsh')
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
