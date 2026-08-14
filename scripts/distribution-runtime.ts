/** Assemble the movable runtime shared by native DeepSeek Harness distributions. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Display name shared by every native distribution. */
export const PRODUCT_NAME = 'DeepSeek Harness'

/** Stable shell command installed by every CLI distribution. */
export const CLI_COMMAND = 'dsh'

/** Absolute repository root for distribution source assets. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Run one distribution command and reject after its process has exited unsuccessfully.
 *
 * @param command Executable name or absolute path.
 * @param args Arguments passed without shell interpretation.
 * @param cwd Child working directory.
 * @returns A promise that resolves only for exit code zero.
 */
export async function run(command: string, args: readonly string[], cwd = repoRoot): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    // Windows `.cmd`/`.bat` shims (e.g. `pnpm.cmd`) are not executable without
    // a shell, so those must run through cmd.exe rather than CreateProcess.
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', env: process.env, shell })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

/** pnpm executable name; Windows resolves the `.cmd` shim, POSIX the bare name. */
function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Resolve an optional `--output` argument.
 *
 * @param argv Command-line arguments.
 * @param defaultOutput Absolute default directory.
 * @returns The absolute output directory.
 */
export function outputArgument(argv: readonly string[], defaultOutput: string): string {
  const index = argv.indexOf('--output')
  if (index < 0) return defaultOutput
  const value = argv[index + 1]
  if (value === undefined || value.length === 0) throw new Error('--output needs a directory')
  return resolve(value)
}

/**
 * Reject broad or unresolved replacement targets before a builder removes them.
 *
 * @param outputRoot Absolute builder-owned output directory.
 * @param target Absolute child selected for replacement.
 */
export function assertSafeOutput(outputRoot: string, target: string): void {
  const relative = target.slice(outputRoot.length)
  // `sep` is the platform path separator: `/` on POSIX, `\` on Windows. The
  // builder's output root is a directory, so a safe child must extend it by
  // the separator before its name.
  if (!target.startsWith(`${outputRoot}${sep}`) || relative.length < 4) {
    throw new Error(`refusing to replace unsafe distribution output ${target}`)
  }
}

async function restoreLegacyHoists(deployedRoot: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(deployedRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = join(repoRoot, 'apps/desktop-runtime/node_modules')
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(deployedRoot, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`distribution runtime dependency ${dependency} is missing from deploy and source install`)
    }
    const nestedNodeModules = join(source, 'node_modules')
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}${sep}`),
    })
    restored.push(dependency)
  }
  if (restored.length > 0) console.log(`Restored legacy deploy hoists: ${restored.join(', ')}`)
}

/**
 * Find the first link below a directory without following it.
 *
 * @param directory Directory to scan recursively.
 * @returns The link path, or undefined when the tree is materialized.
 */
export async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeStagedLinks(deployedRoot: string): Promise<void> {
  const nodeModules = join(deployedRoot, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const source = await realpath(remaining)
    const nestedNodeModules = join(source, 'node_modules')
    await unlink(remaining)
    await cp(source, remaining, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}${sep}`),
    })
    remaining = await findSymlink(nodeModules)
  }
}

/**
 * Remove Finder AppleDouble entries before signing or archiving a distribution.
 *
 * @param directory Distribution tree to sanitize.
 */
export async function removeAppleDouble(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name.startsWith('._')) {
      await rm(path, { recursive: true, force: true })
    } else if (entry.isDirectory()) {
      await removeAppleDouble(path)
    }
  }
}

/**
 * Deploy the production dsh closure and host-native Node executable.
 *
 * @param runtime Runtime directory that will contain `node` and `dsh`.
 * @param config Directory that will contain the desktop and CLI patches.
 */
export async function stagePackagedRuntime(runtime: string, config: string): Promise<void> {
  const deployedDsh = join(runtime, 'dsh')
  await Promise.all([
    mkdir(runtime, { recursive: true }),
    mkdir(config, { recursive: true }),
  ])
  await run(pnpmCommand(), [
    '--filter', 'deepseek-harness-desktop-runtime', 'deploy', '--legacy', '--prod',
    '--config.node-linker=hoisted', '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true', deployedDsh,
  ])
  await restoreLegacyHoists(deployedDsh)
  await materializeStagedLinks(deployedDsh)
  // Legacy deploy mutates pnpm's source-install state; restore it for consecutive builders.
  await run(pnpmCommand(), ['install', '--offline', '--frozen-lockfile'])

  const nodeFilename = basename(process.execPath)
  await copyFile(process.execPath, join(runtime, nodeFilename))
  await chmod(join(runtime, nodeFilename), 0o755)
  await Promise.all([
    copyFile(join(repoRoot, 'desktop/desktop.cordis.patch.yml'), join(config, 'desktop.cordis.patch.yml')),
    copyFile(join(repoRoot, 'desktop/cordis.patch.yml'), join(config, 'cordis.patch.yml')),
    copyFile(join(repoRoot, 'desktop/openai-oauth.mjs'), join(deployedDsh, 'openai-oauth.mjs')),
  ])
}

/** @returns The relocatable POSIX launcher used by every CLI archive. */
export function cliWrapper(): string {
  return `#!/bin/sh
set -eu
script_path=$0
while [ -L "$script_path" ]; do
  link_target=$(readlink "$script_path")
  case "$link_target" in
    /*) script_path=$link_target ;;
    *) script_path=$(dirname -- "$script_path")/$link_target ;;
  esac
done
bin_dir=$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd)
runtime_dir="$bin_dir/../runtime"
dsh_bin="$runtime_dir/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
if [ "$(uname -s)" = Darwin ]; then
  : "\${HOME:?HOME must be set}"
  DSH_HOME=\${DSH_HOME:-"$HOME/Library/Application Support/DeepSeek Harness"}
else
  DSH_HOME=\${DSH_HOME:-"\${XDG_DATA_HOME:-$HOME/.local/share}/deepseek-harness"}
fi
export DSH_HOME
export PATH="$runtime_dir:$runtime_dir/dsh/node_modules/.bin:$PATH"
exec "$runtime_dir/node" "$dsh_bin" "$@"
`
}

/** @returns The relocatable Windows `.cmd` launcher used by the Windows CLI archive. */
export function cliWrapperWindows(): string {
  return `@echo off
setlocal EnableExtensions
set "script_dir=%~dp0"
set "runtime_dir=%script_dir%..\\runtime"
set "dsh_bin=%runtime_dir%\\dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"
if not defined DSH_HOME set "DSH_HOME=%LOCALAPPDATA%\\DeepSeek Harness"
set "PATH=%runtime_dir%;%runtime_dir%\\dsh\\node_modules\\.bin;%PATH%"
"%runtime_dir%\\node.exe" "%dsh_bin%" %*
exit /b %ERRORLEVEL%
`
}

/**
 * Copy a staged runtime into a self-contained CLI directory.
 *
 * @param cliRoot Output directory for the CLI distribution.
 * @param runtime Staged runtime directory.
 * @param config Staged configuration directory.
 */
export async function populateCliDistribution(cliRoot: string, runtime: string, config: string): Promise<void> {
  const windows = process.platform === 'win32'
  const launcherName = windows ? `${CLI_COMMAND}.cmd` : CLI_COMMAND
  const nodeFilename = basename(process.execPath)
  await mkdir(cliRoot, { recursive: true })
  await Promise.all([
    mkdir(join(cliRoot, 'bin'), { recursive: true }),
    cp(runtime, join(cliRoot, 'runtime'), { recursive: true, dereference: true }),
    cp(config, join(cliRoot, 'config'), { recursive: true, dereference: true }),
  ])
  await Promise.all([
    copyFile(join(repoRoot, 'desktop/README.md'), join(cliRoot, 'README.md')),
    copyFile(join(repoRoot, 'desktop/README.zh.md'), join(cliRoot, 'README.zh.md')),
    writeFile(join(cliRoot, 'bin', launcherName), windows ? cliWrapperWindows() : cliWrapper(), { mode: 0o755 }),
  ])
  await chmod(join(cliRoot, 'runtime', nodeFilename), 0o755)
  await chmod(join(cliRoot, 'bin', launcherName), 0o755)
  await removeAppleDouble(cliRoot)
  const remaining = await findSymlink(cliRoot)
  if (remaining !== undefined) {
    throw new Error(`distribution still contains package-manager link ${basename(remaining)}`)
  }
}
