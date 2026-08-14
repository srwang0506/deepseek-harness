/**
 * Self-update for the native CLI distributions.
 *
 * `dsh update` re-runs the published installer for the current platform and
 * architecture, which downloads the latest release archive, verifies its
 * checksum, and replaces the installed runtime (the installer backs up the
 * existing installation first). The running process is unaffected — the
 * replacement lands on the next launch.
 * @module @deepseek-ai/dsh/update
 */

import { spawnSync } from 'node:child_process'

/**
 * Resolve the installer target for the current platform and architecture.
 * @returns the `install.sh`/`install.ps1` scenario name.
 */
export function updateTarget(): string {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'macos-cli'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'windows-arm64'
  throw new Error(`no self-update target for ${process.platform}/${process.arch}; reinstall manually`)
}

/** Run the published installer for the current platform, inheriting stdio. */
export function runUpdate(): void {
  const target = updateTarget()
  const repository = process.env.DEEPSEEK_HARNESS_REPOSITORY ?? 'srwang0506/deepseek-harness'
  const base = `https://github.com/${repository}/releases/latest/download`
  const command = process.platform === 'win32'
    ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${base}/install.ps1' | iex ${target}"`
    : `curl -fsSL '${base}/install.sh' | sh -s -- ${target}`
  const result = spawnSync(command, { stdio: 'inherit', shell: true })
  process.exitCode = result.status ?? 1
}
