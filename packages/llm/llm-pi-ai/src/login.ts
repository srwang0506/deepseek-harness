/**
 * OpenAI GPT credential flows shared by every terminal surface.
 *
 * The optional `openai-codex` provider authenticates through ChatGPT OAuth
 * (browser or device code) or an OpenAI Platform API key. Callers own the
 * credential document path (the CLI and the terminal client resolve
 * `$DSH_HOME/pi-ai-auth.json`) so this module stays free of any path policy.
 * @module dsh-llm-pi-ai/login
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { createModels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { PiAiCredentialStore } from './credential-store.ts'

/** pi-ai provider route id that the optional OpenAI GPT models authenticate through. */
const PROVIDER_ID = 'openai-codex'

/** Login method accepted by {@link loginOpenAi}. */
export type OpenAiLoginMethod = 'browser' | 'device' | 'api-key'

function detached(command: string, args: string[]): void {
  const task = spawn(command, args, { detached: true, stdio: 'ignore' })
  task.once('error', () => undefined)
  task.unref()
}

function openBrowser(url: string): boolean {
  if (process.platform === 'darwin') {
    detached('/usr/bin/open', [url])
    return true
  }
  if (process.platform === 'linux' && (process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY) !== undefined) {
    detached('xdg-open', [url])
    return true
  }
  if (process.platform === 'win32') {
    detached('cmd', ['/c', 'start', '', url])
    return true
  }
  return false
}

function clipboardCommand(): [string, string[]] | undefined {
  if (process.platform === 'darwin') return ['/usr/bin/pbcopy', []]
  if (process.env.WAYLAND_DISPLAY !== undefined) return ['wl-copy', []]
  if (process.env.DISPLAY !== undefined) return ['xclip', ['-selection', 'clipboard']]
  if (process.platform === 'win32') return ['clip', []]
  return undefined
}

function copyToClipboard(value: string): boolean {
  const command = clipboardCommand()
  if (command === undefined) return false
  const task = spawn(command[0], command[1], { stdio: ['pipe', 'ignore', 'ignore'] })
  task.once('error', () => undefined)
  task.stdin.end(value)
  return true
}

/** Read a secret: a hidden TTY prompt when interactive, otherwise stdin. */
async function readHiddenSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8').trim()
  }
  const mutedOutput = new Writable({ write: (_chunk, _encoding, callback) => { callback() } })
  const prompt = createInterface({ input: process.stdin, output: mutedOutput, terminal: true })
  process.stdout.write('OpenAI API Key: ')
  try {
    return (await prompt.question('')).trim()
  } finally {
    prompt.close()
    process.stdout.write('\n')
  }
}

/** Resolve the login method, prompting interactively when none was named. */
async function chooseLoginMethod(requested: string | undefined): Promise<OpenAiLoginMethod> {
  const methods = new Set<string>(['browser', 'device', 'api-key'])
  if (requested !== undefined) {
    if (!methods.has(requested)) throw new Error(`unknown login method ${JSON.stringify(requested)}`)
    return requested as OpenAiLoginMethod
  }
  if (!process.stdin.isTTY) throw new Error('login needs browser, device, or api-key when stdin is not interactive')
  process.stdout.write('Choose an OpenAI login method:\n  1. ChatGPT browser OAuth\n  2. ChatGPT device-code OAuth\n  3. OpenAI API Key\n')
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await prompt.question('Selection [1-3]: ')).trim()
    const methodsByAnswer: Record<string, OpenAiLoginMethod> = { '1': 'browser', '2': 'device', '3': 'api-key' }
    const method = methodsByAnswer[answer]
    if (method === undefined) throw new Error('selection must be 1, 2, or 3')
    return method
  } finally {
    prompt.close()
  }
}

function waitForBrowserCallback(prompt: { signal?: AbortSignal }): Promise<never> {
  return new Promise((_resolve, reject) => {
    const signal = prompt.signal
    if (signal?.aborted) {
      reject(new Error('OAuth browser callback completed'))
      return
    }
    signal?.addEventListener('abort', () => {
      reject(new Error('OAuth browser callback completed'))
    }, { once: true })
  })
}

async function loginOAuth(credentialPath: string, method: 'browser' | 'device'): Promise<void> {
  const credentials = new PiAiCredentialStore(credentialPath)
  const models = createModels({ credentials })
  models.setProvider(openaiCodexProvider())
  await models.login(PROVIDER_ID, 'oauth', {
    prompt: async (prompt) => {
      if (prompt.type === 'select') return method === 'device' ? 'device_code' : 'browser'
      if (prompt.type === 'manual_code') return waitForBrowserCallback(prompt)
      throw new Error(`Unexpected OpenAI OAuth prompt: ${prompt.type}`)
    },
    notify: (event) => {
      switch (event.type) {
        case 'auth_url': {
          const opened = openBrowser(event.url)
          process.stdout.write(opened
            ? '已在浏览器中打开 OpenAI 登录页。完成授权后请返回 DeepSeek Harness。\n'
            : `请在浏览器中打开 ${event.url} 完成 OpenAI 授权。\n`)
          break
        }
        case 'device_code': {
          const copied = copyToClipboard(event.userCode)
          const opened = openBrowser(event.verificationUri)
          process.stdout.write(`设备码：${event.userCode}\n验证地址：${event.verificationUri}\n`)
          if (copied) process.stdout.write('设备码已复制到剪贴板。\n')
          if (opened) process.stdout.write('验证页面已在浏览器中打开。\n')
          break
        }
        case 'progress':
        case 'info':
          process.stdout.write(`${event.message}\n`)
          break
      }
    },
  })
  process.stdout.write('OpenAI OAuth 登录成功。现在可以在模型选择器中使用 GPT 模型。\n')
}

async function loginApiKey(credentialPath: string): Promise<void> {
  const credentials = new PiAiCredentialStore(credentialPath)
  const key = assertUsableApiKey(await readHiddenSecret(), 'DeepSeek Harness', 'OpenAI API Key 输入框')
  await credentials.modify(PROVIDER_ID, () => Promise.resolve({ type: 'api_key' as const, key }))
  process.stdout.write('OpenAI API Key 已保存。GPT 请求将使用标准 OpenAI Responses API。\n')
}

/**
 * Store or refresh the optional OpenAI GPT credential.
 * @param credentialPath - absolute owner-only credential document path.
 * @param method - named login method; when omitted and stdin is a terminal, the user is prompted to choose.
 */
export async function loginOpenAi(credentialPath: string, method: string | undefined): Promise<void> {
  const resolved = await chooseLoginMethod(method)
  if (resolved === 'api-key') return loginApiKey(credentialPath)
  return loginOAuth(credentialPath, resolved)
}

/**
 * Print the current OpenAI GPT login state.
 * @param credentialPath - absolute owner-only credential document path.
 */
export async function openAiStatus(credentialPath: string): Promise<void> {
  const credentials = new PiAiCredentialStore(credentialPath)
  const credential = await credentials.read(PROVIDER_ID)
  if (credential?.type === 'oauth') {
    const models = createModels({ credentials })
    models.setProvider(openaiCodexProvider())
    await models.getAuth(PROVIDER_ID)
    process.stdout.write('OpenAI 已通过 ChatGPT OAuth 登录。\n')
  } else if (credential?.type === 'api_key') {
    process.stdout.write('OpenAI 已通过 API Key 登录。\n')
  } else {
    process.stdout.write('OpenAI 尚未登录。\n')
  }
}

/**
 * Remove the stored OpenAI GPT credential.
 * @param credentialPath - absolute owner-only credential document path.
 */
export async function logoutOpenAi(credentialPath: string): Promise<void> {
  const credentials = new PiAiCredentialStore(credentialPath)
  const models = createModels({ credentials })
  models.setProvider(openaiCodexProvider())
  await models.logout(PROVIDER_ID)
  process.stdout.write('OpenAI 已退出。DeepSeek 默认模型不受影响。\n')
}
