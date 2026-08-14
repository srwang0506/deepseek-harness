/** Native desktop authentication bridge injected before the Harness client boots. */
(() => {
  const handler = globalThis.webkit?.messageHandlers?.openAIAuth
  if (handler === undefined) return

  let requestSequence = 0
  let loginPromise = null
  const pending = new Map()
  const currentProviders = new Map()

  function nativeCall(command, payload = {}) {
    const requestId = `openai-auth-${Date.now()}-${++requestSequence}`
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      handler.postMessage({ requestId, command, ...payload })
    })
  }

  globalThis.__deepseekHarnessOpenAIAuthReply = (requestId, ok, payload) => {
    const operation = pending.get(requestId)
    if (operation === undefined) return
    pending.delete(requestId)
    if (ok) operation.resolve(payload)
    else operation.reject(new Error(payload?.message ?? 'OpenAI 登录失败'))
  }

  async function bodyReady() {
    if (document.body !== null) return
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  }

  async function authenticationDialog() {
    await bodyReady()
    return new Promise((resolve, reject) => {
      const choicesMarkup = `
        <div class="choices">
          <button data-method="browser"><strong>使用 ChatGPT 登录</strong><small>在浏览器完成 OAuth，适合 Plus、Pro 或工作区账号</small></button>
          <button data-method="device"><strong>使用设备码登录</strong><small>设备码会复制到剪贴板，并打开 ChatGPT 验证页面</small></button>
          <button data-method="api-key"><strong>使用 OpenAI API Key</strong><small>通过标准 Responses API，按 Platform 用量计费</small></button>
        </div>`
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647'
      const shadow = host.attachShadow({ mode: 'closed' })
      shadow.innerHTML = `
        <style>
          :host { color-scheme: light dark; }
          * { box-sizing: border-box; }
          .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:24px; background:rgba(10,12,16,.52); backdrop-filter:blur(10px); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          .dialog { width:min(460px,100%); border:1px solid rgba(127,127,127,.28); border-radius:18px; padding:22px; color:#15171a; background:rgba(255,255,255,.98); box-shadow:0 28px 90px rgba(0,0,0,.28); }
          h2 { margin:0 0 6px; font-size:20px; letter-spacing:-.01em; }
          p { margin:0 0 18px; color:#656970; }
          .choices { display:grid; gap:10px; }
          button { width:100%; border:1px solid #d8dbe0; border-radius:12px; padding:12px 14px; color:inherit; background:#fff; text-align:left; cursor:pointer; font:inherit; }
          button:hover { border-color:#111; background:#f7f7f8; }
          button:disabled { cursor:default; opacity:.55; }
          strong, small { display:block; }
          small { margin-top:3px; color:#777b82; }
          .primary { border-color:#111; color:#fff; background:#111; text-align:center; font-weight:600; }
          .primary:hover { color:#fff; background:#252525; }
          .cancel { margin-top:12px; border:0; padding:8px; color:#686c73; background:transparent; text-align:center; }
          .key { display:grid; gap:12px; }
          input { width:100%; border:1px solid #cfd2d7; border-radius:10px; padding:11px 12px; color:inherit; background:#fff; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; outline:none; }
          input:focus { border-color:#111; box-shadow:0 0 0 3px rgba(0,0,0,.08); }
          .status { min-height:72px; display:grid; place-items:center; padding:14px; border-radius:12px; background:#f3f4f6; color:#4c5057; text-align:center; }
          .error { margin-top:12px; color:#b42318; white-space:pre-wrap; }
          a { color:inherit; }
          @media (prefers-color-scheme: dark) {
            .dialog { color:#f4f4f5; background:rgba(29,30,33,.98); }
            p, small, .cancel { color:#a6a8ad; }
            button, input { border-color:#494c52; background:#292b2f; }
            button:hover { border-color:#eee; background:#33353a; }
            .primary { border-color:#f5f5f5; color:#111; background:#f5f5f5; }
            .primary:hover { color:#111; background:#fff; }
            .status { background:#25272b; color:#c7c9ce; }
          }
        </style>
        <div class="backdrop" role="presentation">
          <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="openai-auth-title">
            <h2 id="openai-auth-title">登录 OpenAI 以使用 GPT</h2>
            <p>选择一种方式。ChatGPT 登录使用订阅权限；API Key 使用 OpenAI Platform 按量计费。</p>
            <div class="content">${choicesMarkup}</div>
            <button class="cancel" data-cancel>取消</button>
          </section>
        </div>`
      document.body.append(host)
      const content = shadow.querySelector('.content')
      const cancel = shadow.querySelector('[data-cancel]')
      const finish = (operation, value) => {
        host.remove()
        operation(value)
      }
      const fail = error => {
        const message = error instanceof Error ? error.message : String(error)
        renderChoices(message)
      }
      const login = async (method, apiKey) => {
        const copy = method === 'browser'
          ? '已打开浏览器，正在等待 ChatGPT 授权完成…'
          : method === 'device'
            ? '正在启动设备码登录。设备码会自动复制，请粘贴到打开的验证页面…'
            : '正在验证并保存 API Key…'
        content.innerHTML = `<div class="status"></div>`
        content.querySelector('.status').textContent = copy
        cancel.disabled = true
        try {
          await nativeCall('login', { method, ...(apiKey === undefined ? {} : { apiKey }) })
          finish(resolve, true)
        } catch (error) {
          cancel.disabled = false
          fail(error)
        }
      }
      function showApiKeyEntry() {
        content.innerHTML = `
          <div class="key">
            <input type="password" autocomplete="off" spellcheck="false" aria-label="OpenAI API Key" placeholder="sk-…">
            <button class="primary" data-submit>保存并继续</button>
            <small>密钥只写入本机凭据文件。可从 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI Platform</a> 创建。</small>
          </div>`
        const input = content.querySelector('input')
        const submit = content.querySelector('[data-submit]')
        const send = () => {
          if (input.value.trim().length === 0) return
          void login('api-key', input.value)
        }
        submit.addEventListener('click', send)
        input.addEventListener('keydown', event => { if (event.key === 'Enter') send() })
        input.focus()
      }

      function renderChoices(errorMessage) {
        content.innerHTML = `${choicesMarkup}${errorMessage === undefined ? '' : '<div class="error"></div>'}`
        if (errorMessage !== undefined) content.querySelector('.error').textContent = errorMessage
        for (const button of content.querySelectorAll('[data-method]')) {
          button.addEventListener('click', () => {
            const method = button.dataset.method
            if (method === 'api-key') showApiKeyEntry()
            else void login(method)
          })
        }
      }

      renderChoices()
      cancel.addEventListener('click', () => finish(reject, new Error('OpenAI 登录已取消')))
    })
  }

  async function ensureAuthentication(force = false) {
    if (loginPromise !== null) return loginPromise
    loginPromise = (async () => {
      if (!force) {
        const status = await nativeCall('status')
        if (status?.configured === true) return true
      }
      return authenticationDialog()
    })().finally(() => { loginPromise = null })
    return loginPromise
  }

  globalThis.deepseekHarnessOpenAI = {
    showLogin: () => ensureAuthentication(true).catch(() => false),
    status: () => nativeCall('status'),
  }

  function requestEnvelope(input, init) {
    const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input, location.href) : input?.url === undefined ? null : new URL(input.url)
    if (url === null || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') return null
    if (!url.pathname.startsWith('/api/session.')) return null
    try {
      const envelope = JSON.parse(init.body)
      return envelope?.type === 'client-request' ? envelope : null
    } catch {
      return null
    }
  }

  async function rememberProvider(request, response) {
    if (request === null || (request.method !== 'session.models' && request.method !== 'session.selectModel')) return
    try {
      const envelope = await response.clone().json()
      if (envelope?.result?.ok !== true) return
      const selection = request.method === 'session.models'
        ? envelope.result.value?.current
        : envelope.result.value?.selected
      if (typeof request.payload?.sessionId === 'string' && typeof selection?.provider === 'string') {
        currentProviders.set(request.payload.sessionId, selection.provider)
      }
    } catch {
      // A malformed response remains the API client's error; auth tracking is advisory.
    }
  }

  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input, init) => {
    const request = requestEnvelope(input, init)
    const selectsOpenAI = request?.method === 'session.selectModel' && request.payload?.provider === 'openai-codex'
    const promptsOpenAI = request?.method === 'session.prompt'
      && currentProviders.get(request.payload?.sessionId) === 'openai-codex'
    if (selectsOpenAI || promptsOpenAI) await ensureAuthentication()
    const response = await originalFetch(input, init)
    await rememberProvider(request, response)
    return response
  }
})()
