import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

interface NativeMessage {
  requestId: string
  command: string
  method?: string
  apiKey?: string
}

describe('desktop OpenAI authentication bridge', () => {
  it('serializes scalar request IDs as valid JavaScript string literals', async () => {
    const source = await readFile(new URL('../desktop/DeepSeekHarnessApp.m', import.meta.url), 'utf8')
    expect(source).toMatch(/dataWithJSONObject:requestId[\s\S]*options:NSJSONWritingFragmentsAllowed/)
  })

  it('pauses GPT selection and offers the three Codex-compatible login choices', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:63625/',
    })
    const { window } = dom
    const messages: NativeMessage[] = []
    const globals = window as unknown as Record<string, unknown>
    const originalAttachShadow = Reflect.get(window.HTMLElement.prototype, 'attachShadow')
    window.HTMLElement.prototype.attachShadow = function attachOpenShadow() {
      return Reflect.apply(originalAttachShadow, this, [{ mode: 'open' }])
    }
    globals['webkit'] = {
      messageHandlers: {
        openAIAuth: {
          postMessage(message: NativeMessage) {
            messages.push(message)
            window.queueMicrotask(() => {
              const reply = globals['__deepseekHarnessOpenAIAuthReply'] as
                ((requestId: string, ok: boolean, payload: unknown) => void)
              if (message.command === 'status') reply(message.requestId, true, { configured: false, method: null })
              else reply(message.requestId, true, { message: 'ok' })
            })
          },
        },
      },
    }
    const responseBody = {
      type: 'server-response',
      result: { ok: true, value: { selected: { provider: 'openai-codex', model: 'gpt-5.6-sol' } } },
    }
    let dispatched = false
    globals['fetch'] = async () => {
      dispatched = true
      return new Response(JSON.stringify(responseBody), { headers: { 'content-type': 'application/json' } })
    }
    const source = await readFile(new URL('../desktop/openai-auth-bridge.js', import.meta.url), 'utf8')
    window.eval(source)

    const selection = window.fetch('/api/session.selectModel', {
      method: 'POST',
      body: JSON.stringify({
        type: 'client-request',
        method: 'session.selectModel',
        payload: { sessionId: 's1', provider: 'openai-codex', model: 'gpt-5.6-sol' },
      }),
    })
    await new Promise<void>((resolve) => {
      window.queueMicrotask(() => { resolve() })
    })
    await new Promise<void>((resolve) => {
      window.queueMicrotask(() => { resolve() })
    })

    expect(dispatched).toBe(false)
    const host = window.document.body.firstElementChild as HTMLElement
    const methods = [...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-method]')]
      .map(button => button.dataset.method)
    expect(methods).toEqual(['browser', 'device', 'api-key'])

    host.shadowRoot!.querySelector<HTMLButtonElement>('[data-method="browser"]')!.click()
    await selection
    expect(messages.map(({ command, method }) => ({ command, method }))).toEqual([
      { command: 'status', method: undefined },
      { command: 'login', method: 'browser' },
    ])
    expect(dispatched).toBe(true)
    expect(window.document.body.childElementCount).toBe(0)
    dom.window.close()
  })
})
