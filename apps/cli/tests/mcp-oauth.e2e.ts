/** Real-launcher MCP OAuth login: add, login, get, logout against a mock authorization server. */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** A local MCP authorization server that auto-approves every request. */
async function startMockAuthServer(): Promise<{ baseURL: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    void handle(req, res)
  })
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/.well-known/oauth-authorization-server') {
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
      res.writeHead(302, { Location: `${redirect}?code=mock-code&state=${encodeURIComponent(state)}` })
      res.end()
      return
    }
    if (url.pathname === '/token') {
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
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

describe('dsh mcp OAuth login (real launcher, mock authorization server)', () => {
  it('adds a server, logs in through OAuth, reports it via get, and logs out', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    const mock = await startMockAuthServer()
    const launch = resolveExampleLaunch({ srcBin: dshBinScript, configArgs: [], tsconfigPath, env: {} })
    const run = (args: string[]) => execa(launch.command, [...launch.args, ...args], {
      cwd: home,
      env: {
        ...launch.env,
        DSH_HOME: home,
        DSH_MCP_OPEN_COMMAND: 'curl -sL {url} > /dev/null',
      },
      timeout: 60_000,
      reject: false,
      stripFinalNewline: false,
    })
    try {
      const added = await run(['mcp', 'add', 'mock-server', '--url', mock.baseURL])
      expect(added.exitCode).toBe(0)
      expect(added.stdout).toContain('Added MCP server mock-server')

      const loggedIn = await run(['mcp', 'login', 'mock-server'])
      expect(loggedIn.exitCode).toBe(0)
      expect(loggedIn.stdout).toContain('Logged into MCP server mock-server')

      const got = await run(['mcp', 'get', 'mock-server'])
      expect(got.exitCode).toBe(0)
      expect(got.stdout).toContain('transport: streamable-http')
      expect(got.stdout).toContain('header Authorization: (set)')

      const loggedOut = await run(['mcp', 'logout', 'mock-server'])
      expect(loggedOut.exitCode).toBe(0)
      expect(loggedOut.stdout).toContain('Logged out of MCP server mock-server')

      const after = await run(['mcp', 'get', 'mock-server'])
      expect(after.stdout).toContain('headers: (none)')
    } finally {
      await mock.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
})
