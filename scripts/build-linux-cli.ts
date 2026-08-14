/** Build a self-contained DeepSeek Harness CLI archive on its target Linux host. */

import { mkdir, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  assertSafeOutput,
  CLI_COMMAND,
  outputArgument,
  populateCliDistribution,
  PRODUCT_NAME,
  repoRoot,
  run,
  stagePackagedRuntime,
} from './distribution-runtime.ts'

const defaultOutput = resolve(repoRoot, '../../outputs')

function releaseArchitecture(): 'x64' | 'arm64' {
  if (process.platform !== 'linux') throw new Error('the Linux CLI builder requires Linux')
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch
  throw new Error(`the Linux CLI builder does not support ${process.arch}`)
}

async function main(): Promise<void> {
  const architecture = releaseArchitecture()
  const outputRoot = outputArgument(process.argv.slice(2), defaultOutput)
  const cliRoot = join(outputRoot, `${PRODUCT_NAME} CLI`)
  const archive = join(outputRoot, `deepseek-harness-linux-${architecture}.tar.gz`)
  const stageRoot = join(outputRoot, `.linux-cli-build-${architecture}`)
  for (const target of [cliRoot, archive, stageRoot]) assertSafeOutput(outputRoot, target)

  await mkdir(outputRoot, { recursive: true })
  await Promise.all([cliRoot, archive, stageRoot].map(target => rm(target, { recursive: true, force: true })))
  await run('pnpm', ['run', 'build'])

  const runtime = join(stageRoot, 'runtime')
  const config = join(stageRoot, 'config')
  await stagePackagedRuntime(runtime, config)
  await populateCliDistribution(cliRoot, runtime, config)
  await run(join(cliRoot, 'bin', CLI_COMMAND), ['--help'])
  await run('tar', ['-czf', archive, '-C', outputRoot, basename(cliRoot)])
  await run('tar', ['-tzf', archive, `${basename(cliRoot)}/bin/${CLI_COMMAND}`])
  await rm(stageRoot, { recursive: true, force: true })

  console.log(`Built ${cliRoot}`)
  console.log(`Archive ${archive}`)
}

await main()
