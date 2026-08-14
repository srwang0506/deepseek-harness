/** Build a self-contained DeepSeek Harness CLI archive on its target Windows host. */

import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  assertSafeOutput,
  outputArgument,
  populateCliDistribution,
  PRODUCT_NAME,
  repoRoot,
  run,
  stagePackagedRuntime,
} from './distribution-runtime.ts'

const defaultOutput = resolve(repoRoot, '../../outputs')

function releaseArchitecture(): 'x64' | 'arm64' {
  if (process.platform !== 'win32') throw new Error('the Windows CLI builder requires Windows')
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch
  throw new Error(`the Windows CLI builder does not support ${process.arch}`)
}

async function main(): Promise<void> {
  const architecture = releaseArchitecture()
  const outputRoot = outputArgument(process.argv.slice(2), defaultOutput)
  const cliRoot = join(outputRoot, `${PRODUCT_NAME} CLI`)
  const archive = join(outputRoot, `deepseek-harness-windows-${architecture}.zip`)
  const stageRoot = join(outputRoot, `.windows-cli-build-${architecture}`)
  for (const target of [cliRoot, archive, stageRoot]) assertSafeOutput(outputRoot, target)

  await mkdir(outputRoot, { recursive: true })
  await Promise.all([cliRoot, archive, stageRoot].map(target => rm(target, { recursive: true, force: true })))
  await run('pnpm.cmd', ['run', 'build'])

  const runtime = join(stageRoot, 'runtime')
  const config = join(stageRoot, 'config')
  await stagePackagedRuntime(runtime, config)
  await populateCliDistribution(cliRoot, runtime, config)

  // Smoke the built launcher, then archive with PowerShell's Compress-Archive.
  await run('powershell', ['-NoProfile', '-Command', `& '${join(cliRoot, 'bin', 'dsh.cmd')}' --help`])
  await run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${cliRoot}' -DestinationPath '${archive}' -Force`])
  await rm(stageRoot, { recursive: true, force: true })

  console.log(`Built ${cliRoot}`)
  console.log(`Archive ${archive}`)
}

await main()
