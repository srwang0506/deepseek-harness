import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

describe('DeepSeek Harness native distributions', () => {
  it('uses one product name and a native draggable macOS title bar', async () => {
    const app = await readFile(new URL('../desktop/DeepSeekHarnessApp.m', import.meta.url), 'utf8')
    const runtime = await readFile(new URL('./distribution-runtime.ts', import.meta.url), 'utf8')

    expect(app).toContain('DSHAppName = @"DeepSeek Harness"')
    expect(app).not.toContain('DeeepSeek Harness')
    expect(app).toContain('window.titlebarAppearsTransparent = NO')
    expect(app).toContain('window.movableByWindowBackground = YES')
    expect(app).not.toContain('NSWindowStyleMaskFullSizeContentView')
    expect(runtime).toContain("PRODUCT_NAME = 'DeepSeek Harness'")
    expect(runtime).toContain("CLI_COMMAND = 'deepseek-harness'")
  })

  it('defines native macOS, Linux x64, and Linux ARM64 release assets', async () => {
    const mac = await readFile(new URL('./build-macos-app.ts', import.meta.url), 'utf8')
    const linux = await readFile(new URL('./build-linux-cli.ts', import.meta.url), 'utf8')
    const workflow = await readFile(new URL('../.github/workflows/deepseek-harness-release.yml', import.meta.url), 'utf8')

    expect(mac).toContain("'deepseek-harness-macos-arm64.zip'")
    expect(mac).toContain("'deepseek-harness-cli-macos-arm64.zip'")
    expect(mac).toContain('await removeAppleDouble(appRoot)')
    expect(mac).toContain("['--verify', '--deep', '--strict', '--verbose=2', appRoot]")
    expect(linux).toContain('deepseek-harness-linux-${architecture}.tar.gz')
    expect(workflow).toContain('runner: ubuntu-24.04')
    expect(workflow).toContain('runner: ubuntu-24.04-arm')
    expect(workflow).toContain('runner: macos-15')
    expect(workflow).toContain('gh release create "$TAG"')
  })

  it('runs the CLI entry and preserves unrelated shared settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-harness-cli-'))
    temporaryRoots.push(root)
    const settingsPath = join(root, 'settings.yaml')
    await writeFile(settingsPath, 'ui-onboarding:\n  modelSelection: true\n')
    const entry = fileURLToPath(new URL('../apps/desktop-runtime/cli-entry.mjs', import.meta.url))
    const environment = { ...process.env, DSH_HOME: root }

    const help = await execFileAsync(process.execPath, [entry, '--help'], {
      encoding: 'utf8',
      env: environment,
    })
    expect(help.stdout).toContain('DeepSeek Harness CLI')
    expect(help.stdout).toContain('deepseek-harness login [browser|device|api-key]')

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

  it('installs a checksum-verified release through the published script', async () => {
    if (!['darwin', 'linux'].includes(process.platform)) return
    const root = await mkdtemp(join(tmpdir(), 'deepseek-harness-installer-'))
    temporaryRoots.push(root)
    const release = join(root, 'release')
    const payload = join(root, 'payload')
    const cli = join(payload, 'DeepSeek Harness CLI')
    const cliLauncher = join(cli, 'bin/deepseek-harness')
    await mkdir(join(cli, 'bin'), { recursive: true })
    await writeFile(cliLauncher, '#!/bin/sh\necho installed\n')
    await chmod(cliLauncher, 0o755)
    await mkdir(release, { recursive: true })

    const assets: string[] = []
    if (process.platform === 'darwin') {
      const app = join(payload, 'DeepSeek Harness.app')
      const appAsset = 'deepseek-harness-macos-arm64.zip'
      const cliAsset = 'deepseek-harness-cli-macos-arm64.zip'
      await mkdir(join(app, 'Contents'), { recursive: true })
      await writeFile(join(app, 'Contents/Info.plist'), '<plist/>\n')
      assets.push(appAsset, cliAsset)
      await execFileAsync('ditto', ['-c', '-k', '--keepParent', app, join(release, appAsset)])
      await execFileAsync('ditto', ['-c', '-k', '--keepParent', cli, join(release, cliAsset)])
    } else {
      const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
      const cliAsset = `deepseek-harness-linux-${architecture}.tar.gz`
      assets.push(cliAsset)
      await execFileAsync('tar', ['-czf', join(release, cliAsset), '-C', payload, 'DeepSeek Harness CLI'])
    }
    await writeFile(
      join(release, 'SHA256SUMS'),
      `${(await Promise.all(assets.map(async asset => `${await sha256(join(release, asset))}  ${asset}`))).join('\n')}\n`,
    )

    const home = join(root, 'home')
    const bin = join(root, 'bin')
    const installRoot = join(root, 'installed-cli')
    const appDir = join(root, 'Applications')
    await mkdir(home)
    const installer = fileURLToPath(new URL('./install-release.sh', import.meta.url))
    await execFileAsync('/bin/sh', [installer], {
      env: {
        ...process.env,
        DEEPSEEK_HARNESS_RELEASE_BASE: pathToFileURL(release).href,
        DEEPSEEK_HARNESS_INSTALL_ROOT: installRoot,
        DEEPSEEK_HARNESS_BIN_DIR: bin,
        DEEPSEEK_HARNESS_APP_DIR: appDir,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
    })

    expect(await readlink(join(bin, 'deepseek-harness'))).toBe(join(installRoot, 'bin/deepseek-harness'))
    const installed = await execFileAsync(join(bin, 'deepseek-harness'), ['--help'], { encoding: 'utf8' })
    expect(installed.stdout).toBe('installed\n')
    if (process.platform === 'darwin') {
      expect(await readFile(join(appDir, 'DeepSeek Harness.app/Contents/Info.plist'), 'utf8')).toBe('<plist/>\n')
    }
  })
})
