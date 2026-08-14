#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { createModels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { PiAiCredentialStore } from '@deepseek-ai/dsh-llm-pi-ai'

const [command, credentialStorePath] = process.argv.slice(2)
if (!credentialStorePath || !isAbsolute(credentialStorePath)) {
  throw new Error('OpenAI OAuth credential path must be absolute')
}

const providerId = 'openai-codex'
const models = createModels({ credentials: new PiAiCredentialStore(credentialStorePath) })
models.setProvider(openaiCodexProvider())

function openBrowser(url) {
  const task = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' })
  task.unref()
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

async function login() {
  await models.login(providerId, 'oauth', {
    prompt: async (prompt) => {
      if (prompt.type === 'select') return 'browser'
      if (prompt.type === 'manual_code') return waitForBrowserCallback(prompt)
      throw new Error(`Unexpected OpenAI OAuth prompt: ${prompt.type}`)
    },
    notify: (event) => {
      if (event.type === 'auth_url') {
        openBrowser(event.url)
        process.stdout.write('已在浏览器中打开 OpenAI 登录页。完成授权后请返回此 App。\n')
      } else if (event.type === 'progress' || event.type === 'info') {
        process.stdout.write(`${event.message}\n`)
      }
    },
  })
  process.stdout.write('OpenAI OAuth 登录成功。现在可以在模型选择器中使用 GPT 模型。\n')
}

async function status() {
  const auth = await models.getAuth(providerId)
  process.stdout.write(auth?.source === 'OAuth' ? 'OpenAI OAuth 已登录。\n' : 'OpenAI OAuth 尚未登录。\n')
}

async function logout() {
  await models.logout(providerId)
  process.stdout.write('OpenAI OAuth 已退出。DeepSeek 默认模型不受影响。\n')
}

if (command === 'login') {
  await login()
} else if (command === 'status') {
  await status()
} else if (command === 'logout') {
  await logout()
} else {
  throw new Error('Usage: openai-oauth.mjs <login|status|logout> <absolute-credential-path>')
}
