#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { createModels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { PiAiCredentialStore } from '@deepseek-ai/dsh-llm-pi-ai'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'

const [command, credentialStorePath, loginMethod] = process.argv.slice(2)
if (!credentialStorePath || !isAbsolute(credentialStorePath)) {
  throw new Error('OpenAI credential path must be absolute')
}

const providerId = 'openai-codex'
const credentials = new PiAiCredentialStore(credentialStorePath)
const models = createModels({ credentials })
models.setProvider(openaiCodexProvider())

function openBrowser(url) {
  const task = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' })
  task.unref()
}

function copyToClipboard(value) {
  const task = spawn('/usr/bin/pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
  task.once('error', () => undefined)
  task.stdin.end(value)
}

async function readSecret() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

function waitForBrowserCallback(prompt) {
  return new Promise((_resolve, reject) => {
    const signal = prompt.signal
    if (signal?.aborted) {
      reject(new Error('OAuth browser callback completed'))
      return
    }
    signal?.addEventListener('abort', () => reject(new Error('OAuth browser callback completed')), { once: true })
  })
}

async function loginOAuth(method) {
  if (method !== 'browser' && method !== 'device') {
    throw new Error('OpenAI OAuth login method must be browser or device')
  }
  await models.login(providerId, 'oauth', {
    prompt: async (prompt) => {
      if (prompt.type === 'select') return method === 'device' ? 'device_code' : 'browser'
      if (prompt.type === 'manual_code') return waitForBrowserCallback(prompt)
      throw new Error(`Unexpected OpenAI OAuth prompt: ${prompt.type}`)
    },
    notify: (event) => {
      if (event.type === 'auth_url') {
        openBrowser(event.url)
        process.stdout.write('已在浏览器中打开 OpenAI 登录页。完成授权后请返回 DeeepSeek Harness。\n')
      } else if (event.type === 'device_code') {
        copyToClipboard(event.userCode)
        openBrowser(event.verificationUri)
        process.stdout.write(`设备码 ${event.userCode} 已复制到剪贴板，并已打开验证页面。\n`)
      } else if (event.type === 'progress' || event.type === 'info') {
        process.stdout.write(`${event.message}\n`)
      }
    },
  })
  process.stdout.write('OpenAI OAuth 登录成功。现在可以在模型选择器中使用 GPT 模型。\n')
}

async function loginApiKey() {
  const key = assertUsableApiKey(await readSecret(), 'DeeepSeek Harness', 'OpenAI API Key 输入框')
  await credentials.modify(providerId, async () => ({ type: 'api_key', key }))
  process.stdout.write('OpenAI API Key 已保存。GPT 请求将使用标准 OpenAI Responses API。\n')
}

async function login() {
  if (loginMethod === 'api-key') return loginApiKey()
  return loginOAuth(loginMethod ?? 'browser')
}

async function status() {
  const credential = await credentials.read(providerId)
  if (credential?.type === 'oauth') {
    await models.getAuth(providerId)
    process.stdout.write('OpenAI 已通过 ChatGPT OAuth 登录。\n')
  } else if (credential?.type === 'api_key') {
    process.stdout.write('OpenAI 已通过 API Key 登录。\n')
  } else {
    process.stdout.write('OpenAI 尚未登录。\n')
  }
}

async function statusJson() {
  const credential = await credentials.read(providerId)
  if (credential?.type === 'oauth') await models.getAuth(providerId)
  process.stdout.write(JSON.stringify({
    configured: credential !== undefined,
    method: credential?.type === 'oauth' ? 'chatgpt' : credential?.type === 'api_key' ? 'api-key' : null,
  }))
}

async function logout() {
  await models.logout(providerId)
  process.stdout.write('OpenAI 已退出。DeepSeek 默认模型不受影响。\n')
}

if (command === 'login') {
  await login()
} else if (command === 'status') {
  await status()
} else if (command === 'status-json') {
  await statusJson()
} else if (command === 'logout') {
  await logout()
} else {
  throw new Error('Usage: openai-oauth.mjs <login|status|status-json|logout> <absolute-credential-path> [browser|device|api-key]')
}
