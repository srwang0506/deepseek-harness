/**
 * The MCP Authorization login flow: protected-resource/authorization-server
 * discovery, PKCE browser authorization through the bundled MCP SDK, a
 * loopback redirect listener, and the token exchange. Token persistence and
 * patch-row wiring belong to the caller (the `dsh mcp` CLI).
 * @module @deepseek-ai/dsh-mcp-client/login
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

/**
 * Reject a pending login callback as timed out. Standalone so `setTimeout`
 * can pass it directly (no anonymous wrapper) and tests can call it; the
 * reject rides a holder object so the timer observes the promise's real
 * reject, assigned inside the promise executor.
 * @param listener - the loopback listener to close.
 * @param holder - the callback promise's reject holder.
 */
export function rejectLoginTimeout(listener: Server, holder: { reject?: (error: Error) => void }): void {
  listener.close()
  const reject = holder.reject
  if (reject === undefined) throw new Error('mcp login: the login callback settled without a reject')
  reject(new Error('mcp login: timed out waiting for the authorization redirect'))
}

/** Default wait for the authorization redirect (five minutes). */
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000

/** Options for {@link loginMcpServer}. */
export interface McpLoginOptions {
  /**
   * Detached shell command template that opens the authorization URL;
   * `{url}` is replaced. Defaults to the platform opener.
   */
  openCommand?: string
  /** Optional cancellation for the loopback wait. */
  signal?: AbortSignal
  /** How long to wait for the authorization redirect before failing. */
  timeoutMs?: number
  /** Fetch override for tests. */
  fetchFn?: typeof fetch
}

/**
 * The platform's default detached opener command template.
 * @returns the shell command with a `{url}` placeholder.
 */
export function defaultOpenCommand(): string {
  if (process.platform === 'darwin') return '/usr/bin/open {url}'
  if (process.platform === 'win32') return 'cmd /c start "" {url}'
  return 'xdg-open {url}'
}

/**
 * Shell-quote one value for a `shell: true` command template.
 * @param value - the value to quote.
 * @returns the single-quoted shell word.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Open one URL in a detached shell process; spawn failures never block the
 * flow.
 * @param url - the URL to hand to the command.
 * @param openCommand - the command template with a `{url}` placeholder.
 */
export function openDetached(url: string, openCommand: string): void {
  const child = spawn(openCommand.replaceAll('{url}', shellQuote(url)), {
    shell: true,
    stdio: 'ignore',
    detached: true,
  })
  /* v8 ignore next -- a spawn error needs a broken shell; the handler only keeps the flow alive. */
  child.on('error', () => {})
  child.unref()
}

/**
 * Run the MCP Authorization login for one streamable-HTTP server: discover
 * the authorization server, start a PKCE authorization, serve the loopback
 * redirect, open the browser, and exchange the code for tokens.
 * @param serverUrl - the MCP server's base URL.
 * @param options - open command, abort signal, redirect timeout, and fetch override.
 * @returns the exchanged tokens (access token always, refresh token when issued).
 */
export async function loginMcpServer(serverUrl: string, options: McpLoginOptions): Promise<OAuthTokens> {
  const fetchFn = options.fetchFn
  const { authorizationServerUrl, authorizationServerMetadata } = await discoverOAuthServerInfo(serverUrl, {
    ...(fetchFn === undefined ? {} : { fetchFn }),
  })

  // Bind the loopback listener first so the redirect URL carries a real port.
  const listener: Server = createServer()
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      listener.off('error', reject)
      resolve()
    })
  })
  const address = listener.address()
  /* v8 ignore next 3 -- a listening TCP server always reports an address object. */
  if (address === null || typeof address === 'string') {
    listener.close()
    throw new Error('mcp login: the loopback redirect listener did not bind a TCP port')
  }
  const redirectUrl = `http://127.0.0.1:${address.port}/callback`
  const clientInformation = {
    redirect_uris: [redirectUrl],
    token_endpoint_auth_method: 'none',
  } as OAuthClientInformationMixed

  const rejectHolder: { reject?: (error: Error) => void } = {}
  const callback = new Promise<string>((resolve, reject) => {
    rejectHolder.reject = reject
    const finish = (value: string | Error): void => {
      clearTimeout(timer)
      if (value instanceof Error) reject(value)
      else resolve(value)
    }
    if (options.signal?.aborted === true) {
      listener.close()
      reject(new Error('mcp login aborted'))
      return
    }
    listener.on('request', (req, res) => {
      /* v8 ignore next -- Node always sets the request URL; the fallback only satisfies the type. */
      const url = new URL(req.url ?? '/', redirectUrl)
      /* v8 ignore start -- nothing else targets the loopback port; the guard keeps stray probes quiet. */
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      /* v8 ignore stop */
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('Login complete. You may close this tab and return to the terminal.')
      listener.close()
      const code = url.searchParams.get('code')
      if (code === null) finish(new Error('mcp login: the authorization server redirected without a code'))
      else finish(code)
    })
    options.signal?.addEventListener('abort', () => {
      listener.close()
      reject(new Error('mcp login aborted'))
    }, { once: true })
  })
  const timer = setTimeout(
    rejectLoginTimeout,
    options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS,
    listener,
    rejectHolder,
  )

  try {
    const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
      ...(authorizationServerMetadata === undefined ? {} : { metadata: authorizationServerMetadata }),
      clientInformation,
      redirectUrl,
    })
    openDetached(String(authorizationUrl), options.openCommand ?? defaultOpenCommand())
    const authorizationCode = await callback
    return await exchangeAuthorization(authorizationServerUrl, {
      ...(authorizationServerMetadata === undefined ? {} : { metadata: authorizationServerMetadata }),
      clientInformation,
      authorizationCode,
      codeVerifier,
      redirectUri: redirectUrl,
      ...(fetchFn === undefined ? {} : { fetchFn }),
    })
  } finally {
    listener.close()
  }
}
