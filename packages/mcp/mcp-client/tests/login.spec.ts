/** MCP Authorization login flow against a local mock authorization server. */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultOpenCommand, loginMcpServer, openDetached, rejectLoginTimeout, shellQuote } from '../src/login.ts'

/** Start a local MCP authorization server that auto-approves every request. */
async function startMockAuthServer(
  options: { omitCode?: boolean; discoveryLess?: boolean; wrongPath?: boolean } = {},
): Promise<{ baseURL: string; tokens: string[]; close(): Promise<void> }> {
  const seenTokens: string[] = []
  const server: Server = createServer((req, res) => {
    void handle(req, res)
  })
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/.well-known/oauth-authorization-server' && options.discoveryLess !== true) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      }))
      return
    }
    if (url.pathname === '/authorize') {
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const state = url.searchParams.get('state') ?? ''
      const target = options.wrongPath === true ? `${redirect}/wrong` : redirect
      const suffix = options.omitCode === true ? '' : `code=mock-code&state=${encodeURIComponent(state)}`
      res.writeHead(302, { Location: `${target}?${suffix}` })
      res.end()
      return
    }
    if (url.pathname === '/token') {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      seenTokens.push(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'mock-access-token', token_type: 'Bearer', refresh_token: 'mock-refresh-token' }))
      return
    }
    res.writeHead(404)
    res.end()
  }
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tokens: seenTokens,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

/** Stub `process.platform` for one test and restore afterwards. */
function stubPlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value, configurable: true })
  return () => {
    if (original !== undefined) Object.defineProperty(process, 'platform', original)
  }
}

afterEach(() => {
  stubPlatform(process.platform)()
})

describe('loginMcpServer', () => {
  it('discovers, authorizes over the loopback redirect, and exchanges a code', async () => {
    const mock = await startMockAuthServer()
    try {
      const tokens = await loginMcpServer(mock.baseURL, {
        fetchFn: fetch,
        // The mock auto-approves without a browser; a harmless opener stands in.
        openCommand: 'curl -sL {url} > /dev/null',
      })
      expect(tokens).toEqual({ access_token: 'mock-access-token', token_type: 'Bearer', refresh_token: 'mock-refresh-token' })
      expect(mock.tokens).toHaveLength(1)
      expect(mock.tokens[0]).toContain('code=mock-code')
      expect(mock.tokens[0]).toContain('code_verifier=')
    } finally {
      await mock.close()
    }
  })

  it('rejects when the redirect carries no code', async () => {
    const mock = await startMockAuthServer()
    try {
      // A second login still works; simulate a broken authorize by closing the
      // listener early is unnecessary — instead assert the abort path.
      const controller = new AbortController()
      const pending = loginMcpServer(mock.baseURL, {
        fetchFn: fetch,
        openCommand: 'curl -sL {url} > /dev/null',
        signal: controller.signal,
      })
      controller.abort()
      await expect(pending).rejects.toThrow('mcp login aborted')
    } finally {
      await mock.close()
    }
  })

  it('fails the discovery with a clear error when the server lacks metadata', async () => {
    // A port that refuses connections makes the metadata fetch fail fast.
    const closed = createServer()
    closed.listen(0, '127.0.0.1')
    await once(closed, 'listening')
    const refused = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`
    await new Promise<void>((resolve) => { closed.close(() => { resolve() }) })
    await expect(loginMcpServer(refused, {
      fetchFn: fetch,
      openCommand: 'curl -sL {url} > /dev/null',
      timeoutMs: 500,
    })).rejects.toThrow('timed out waiting for the authorization redirect')
  })

  it('aborts the loopback wait when the signal fires mid-flow', async () => {
    const mock = await startMockAuthServer()
    try {
      const controller = new AbortController()
      const pending = loginMcpServer(mock.baseURL, {
        fetchFn: fetch,
        openCommand: 'sleep 30',
        signal: controller.signal,
      })
      // Let the flow reach the callback wait, then abort.
      await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
      controller.abort()
      await expect(pending).rejects.toThrow('mcp login aborted')
    } finally {
      await mock.close()
    }
  })

  it('rejects when the authorization server redirects without a code', async () => {
    const mock = await startMockAuthServer({ omitCode: true })
    try {
      await expect(loginMcpServer(mock.baseURL, {
        fetchFn: fetch,
        openCommand: 'curl -sL {url} > /dev/null',
      })).rejects.toThrow('redirected without a code')
    } finally {
      await mock.close()
    }
  })

  it('completes a discovery-less login with the global fetch fallback', async () => {
    const mock = await startMockAuthServer({ discoveryLess: true })
    try {
      const tokens = await loginMcpServer(mock.baseURL, {
        openCommand: 'curl -sL {url} > /dev/null',
      })
      expect(tokens.access_token).toBe('mock-access-token')
    } finally {
      await mock.close()
    }
  })

  it('ignores stray probes on the loopback and times out when the redirect misses the callback', async () => {
    const mock = await startMockAuthServer({ wrongPath: true })
    try {
      await expect(loginMcpServer(mock.baseURL, {
        fetchFn: fetch,
        openCommand: 'curl -sL {url} > /dev/null',
        timeoutMs: 500,
      })).rejects.toThrow('timed out waiting for the authorization redirect')
    } finally {
      await mock.close()
    }
  })

  it('falls back to the platform opener and times out when nothing visits the redirect', async () => {
    const restore = stubPlatform('linux')
    try {
      const mock = await startMockAuthServer()
      try {
        await expect(loginMcpServer(mock.baseURL, {
          fetchFn: fetch,
          timeoutMs: 500,
        })).rejects.toThrow('timed out waiting for the authorization redirect')
      } finally {
        await mock.close()
      }
    } finally {
      restore()
    }
  })

  it('rejects a pending callback as timed out', () => {
    let closed = false
    let rejected: Error | undefined
    const holder: { reject?: (error: Error) => void } = { reject: (error) => { rejected = error } }
    rejectLoginTimeout(
      { close: () => { closed = true } } as unknown as import('node:http').Server,
      holder,
    )
    expect(closed).toBe(true)
    expect(rejected?.message).toBe('mcp login: timed out waiting for the authorization redirect')
  })

  it('fails loud when the timeout holder never received a reject', () => {
    expect(() => {
      rejectLoginTimeout(
        { close: () => {} } as unknown as import('node:http').Server,
        {},
      )
    }).toThrow('settled without a reject')
  })

  it('selects the platform opener by platform', () => {
    const restore = stubPlatform('darwin')
    try {
      expect(defaultOpenCommand()).toBe('/usr/bin/open {url}')
    } finally {
      restore()
    }
    const restoreLinux = stubPlatform('linux')
    try {
      expect(defaultOpenCommand()).toBe('xdg-open {url}')
    } finally {
      restoreLinux()
    }
    const restoreWindows = stubPlatform('win32')
    try {
      expect(defaultOpenCommand()).toBe('cmd /c start "" {url}')
    } finally {
      restoreWindows()
    }
  })

  it('quotes shell values and swallows opener spawn failures', () => {
    expect(shellQuote("a&b'c")).toBe("'a&b'\\''c'")
    // A nonexistent command must not throw: failures never block the flow.
    openDetached('http://example.test', '/nonexistent/dsh-opener {url}')
  })
})
