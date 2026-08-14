import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DeeepSeek Harness macOS distributions', () => {
  it('uses the requested product name and a native draggable title bar', async () => {
    const source = await readFile(new URL('../desktop/DeepSeekHarnessApp.m', import.meta.url), 'utf8')

    expect(source).toContain('DSHAppName = @"DeeepSeek Harness"')
    expect(source).toContain('window.titlebarAppearsTransparent = NO')
    expect(source).toContain('window.movableByWindowBackground = YES')
    expect(source).not.toContain('NSWindowStyleMaskFullSizeContentView')
  })

  it('builds fresh App and CLI archives without AppleDouble metadata', async () => {
    const source = await readFile(new URL('./build-macos-app.ts', import.meta.url), 'utf8')

    expect(source).toContain("const PRODUCT_NAME = 'DeeepSeek Harness'")
    expect(source).toContain("'deeepseek-harness-macos-arm64.zip'")
    expect(source).toContain("'deeepseek-harness-cli-macos-arm64.zip'")
    expect(source).toContain('await removeAppleDouble(appRoot)')
    expect(source).toContain("['--verify', '--deep', '--strict', '--verbose=2', appRoot]")
    expect(source).toContain('while [ -L "$script_path" ]')
  })

  it('runs the shipped CLI entry and preserves unrelated shared settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deeepseek-harness-cli-'))
    temporaryRoots.push(root)
    const settingsPath = join(root, 'settings.yaml')
    await writeFile(settingsPath, 'ui-onboarding:\n  modelSelection: true\n')
    const entry = fileURLToPath(new URL('../apps/desktop-runtime/cli-entry.mjs', import.meta.url))
    const environment = { ...process.env, DSH_HOME: root }

    const help = await execFileAsync(process.execPath, [entry, '--help'], {
      encoding: 'utf8',
      env: environment,
    })
    expect(help.stdout).toContain('DeeepSeek Harness CLI')
    expect(help.stdout).toContain('deeepseek-harness login [browser|device|api-key]')

    const selected = await execFileAsync(
      process.execPath,
      [entry, 'model', 'gpt', 'gpt-5.6-sol', 'xhigh'],
      { encoding: 'utf8', env: environment },
    )
    expect(selected.stdout).toBe('Selected openai-codex/gpt-5.6-sol (xhigh)\n')

    const settings = await readFile(settingsPath, 'utf8')
    expect(settings).toContain('modelSelection: true')
    expect(settings).toContain('provider: openai-codex')
    expect(settings).toContain('model: gpt-5.6-sol')
    expect(settings).toContain('reasoningEffort: xhigh')
  })
})
