#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const PRODUCT_NAME = 'DeeepSeek Harness'
const runtimeRoot = dirname(fileURLToPath(import.meta.url))
const distributionRoot = resolve(runtimeRoot, '../..')
const nodeExecutable = join(distributionRoot, 'runtime/node')
const dshEntrypoint = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const oauthEntrypoint = join(runtimeRoot, 'openai-oauth.mjs')
const cliPatch = join(distributionRoot, 'config/cli.cordis.patch.yml')
const desktopPatch = join(distributionRoot, 'config/desktop.cordis.patch.yml')
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), 'Library/Application Support/DeepSeek Harness'))
const settingsPath = join(dshHome, 'settings.yaml')
const credentialPath = join(dshHome, 'pi-ai-auth.json')

const HELP = `${PRODUCT_NAME} CLI

Usage:
  deeepseek-harness <task...>                    run one coding task and exit
  deeepseek-harness run <task...>                same as above
  deeepseek-harness web [web options...]          start the Harness web UI
  deeepseek-harness login [browser|device|api-key]
  deeepseek-harness status                       show OpenAI login status
  deeepseek-harness logout                       remove the OpenAI credential
  deeepseek-harness model                        show the selected default model
  deeepseek-harness model deepseek               select DeepSeek V4 Flash
  deeepseek-harness model gpt [model] [effort]   select OpenAI GPT
  deeepseek-harness raw <dsh arguments...>       invoke the bundled dsh CLI

The CLI and App share settings, sessions, and OpenAI credentials. DeepSeek is
the installation default; GPT remains opt-in and requires one login method.
`

function childEnvironment() {
  const path = [
    dirname(nodeExecutable),
    join(runtimeRoot, 'node_modules/.bin'),
    process.env.PATH,
  ].filter(value => typeof value === 'string' && value.length > 0).join(':')
  return {
    ...process.env,
    PATH: path,
    DSH_HOME: dshHome,
    DSH_CWD: process.env.DSH_CWD ?? process.cwd(),
    DSH_TELEMETRY_DISABLED: '1',
    DSH_TOOLS_MODE: process.env.DSH_TOOLS_MODE ?? 'both',
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: childEnvironment(),
      stdio: options.stdio ?? 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      const signalExitCode = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 128
      resolvePromise(code ?? (signal === null ? 1 : signalExitCode))
    })
    if (options.secret !== undefined) child.stdin.end(options.secret)
  })
}

async function readHiddenSecret() {
  if (!process.stdin.isTTY) {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8').trim()
  }
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) { callback() },
  })
  const prompt = createInterface({ input: process.stdin, output: mutedOutput, terminal: true })
  process.stdout.write('OpenAI API Key: ')
  try {
    return (await prompt.question('')).trim()
  } finally {
    prompt.close()
    process.stdout.write('\n')
  }
}

async function chooseLoginMethod(requested) {
  const methods = new Set(['browser', 'device', 'api-key'])
  if (requested !== undefined) {
    if (!methods.has(requested)) throw new Error(`unknown login method ${JSON.stringify(requested)}`)
    return requested
  }
  if (!process.stdin.isTTY) throw new Error('login needs browser, device, or api-key when stdin is not interactive')
  process.stdout.write(`Choose an OpenAI login method:\n  1. ChatGPT browser OAuth\n  2. ChatGPT device-code OAuth\n  3. OpenAI API Key\n`)
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await prompt.question('Selection [1-3]: ')).trim()
    const method = { 1: 'browser', 2: 'device', 3: 'api-key' }[answer]
    if (method === undefined) throw new Error('selection must be 1, 2, or 3')
    return method
  } finally {
    prompt.close()
  }
}

async function login(requested) {
  const method = await chooseLoginMethod(requested)
  if (method !== 'api-key') {
    return run(nodeExecutable, [oauthEntrypoint, 'login', credentialPath, method])
  }
  const secret = await readHiddenSecret()
  if (secret.length === 0) throw new Error('OpenAI API Key cannot be empty')
  return run(nodeExecutable, [oauthEntrypoint, 'login', credentialPath, method], {
    stdio: ['pipe', 'inherit', 'inherit'],
    secret,
  })
}

async function readSettingsDocument() {
  let text = ''
  try {
    text = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const document = parseDocument(text)
  if (document.errors.length > 0) throw new Error(`cannot parse ${settingsPath}: ${document.errors[0].message}`)
  const value = document.toJS()
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`${settingsPath} must contain a YAML mapping`)
  }
  return document
}

async function saveModel(selection) {
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  await withFileLock(settingsPath, async () => {
    const document = await readSettingsDocument()
    document.setIn(['agent-default-model'], selection)
    await writeFileAtomic(settingsPath, String(document), { mode: 0o600, dirMode: 0o700 })
  })
  process.stdout.write(`Selected ${selection.provider}/${selection.model}${selection.reasoningEffort === undefined ? '' : ` (${selection.reasoningEffort})`}\n`)
}

async function showModel() {
  const document = await readSettingsDocument()
  const settings = document.toJS()
  const selection = settings?.['agent-default-model']
  if (selection === undefined || selection === null) {
    process.stdout.write('Selected deepseek-official/deepseek-v4-flash (installation default)\n')
    return
  }
  if (typeof selection !== 'object' || Array.isArray(selection)
    || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new Error(`${settingsPath} has an invalid agent-default-model section`)
  }
  process.stdout.write(`Selected ${selection.provider}/${selection.model}${selection.reasoningEffort === undefined ? '' : ` (${selection.reasoningEffort})`}\n`)
}

async function model(args) {
  if (args.length > 3) throw new Error('model accepts at most a family, model id, and reasoning effort')
  const [family, modelId, reasoningEffort] = args
  if (family === undefined || family === 'status') return showModel()
  if (family === 'deepseek') {
    if (modelId !== undefined || reasoningEffort !== undefined) throw new Error('model deepseek takes no additional arguments')
    return saveModel({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  }
  if (family === 'gpt') {
    return saveModel({
      provider: 'openai-codex',
      model: modelId ?? 'gpt-5.6-sol',
      reasoningEffort: reasoningEffort ?? 'high',
    })
  }
  throw new Error('model must be deepseek, gpt, or status')
}

async function main(args) {
  const [command, ...rest] = args
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (command === 'login') return login(rest[0])
  if (command === 'status') return run(nodeExecutable, [oauthEntrypoint, 'status', credentialPath])
  if (command === 'logout') return run(nodeExecutable, [oauthEntrypoint, 'logout', credentialPath])
  if (command === 'model') {
    await model(rest)
    return 0
  }
  if (command === 'web') return run(nodeExecutable, [dshEntrypoint, 'web', '--patch', desktopPatch, ...rest])
  if (command === 'raw') {
    if (rest.length === 0) throw new Error('raw needs dsh arguments')
    return run(nodeExecutable, [dshEntrypoint, ...rest])
  }
  const task = command === 'run' ? rest : args
  if (task.length === 0) throw new Error('run needs a task')
  return run(nodeExecutable, [dshEntrypoint, '--profile', 'headless', '--patch', cliPatch, ...task])
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${PRODUCT_NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
