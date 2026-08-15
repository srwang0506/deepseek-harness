/**
 * MCP server management for the `dsh` CLI.
 *
 * Servers are `dsh-mcp-client` rows in the home-level
 * `$DSH_HOME/cordis.patch.yml`, the patch applied to every profile boot, so a
 * configured server's tools join each session. `add` replaces a same-named
 * row; `remove` deletes it; `list` prints the configured servers.
 * @module @deepseek-ai/dsh/mcp
 */

import { mkdir, readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { loginMcpServer as runMcpOAuthLogin } from '@deepseek-ai/dsh-mcp-client'
import { parseDocument, stringify } from 'yaml'
import type { Document } from 'yaml'

/** The home-owned credential document for MCP OAuth tokens, keyed by server name. */
export function mcpAuthPath(): string {
  return dshHomePath('mcp-auth.json')
}

/** One stored MCP OAuth token record. */
interface McpStoredTokens {
  access_token: string
  refresh_token?: string
  token_type?: string
}

/** Read the stored token document, or an empty object when absent. */
async function readMcpAuth(): Promise<Record<string, McpStoredTokens>> {
  const path = mcpAuthPath()
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (text.trim() === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`)
  }
  return parsed as Record<string, McpStoredTokens>
}

/** Write the stored token document atomically under the home lock. */
async function writeMcpAuth(document: Record<string, McpStoredTokens>): Promise<void> {
  const path = mcpAuthPath()
  await mkdir(dshHomePath(), { recursive: true, mode: 0o700 })
  await withFileLock(path, async () => {
    await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  })
}

/** Plugin name of the stdio/streamable-http MCP client. */
const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/** Valid server names, kept below the plugin's public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Options accepted by `dsh mcp add`. */
export interface McpOptions {
  /** Executable for a stdio server; required unless `url` is given. */
  command?: string
  /** Arguments passed without shell interpretation. */
  args: string[]
  /** Streamable-HTTP endpoint URL; given instead of `command`. */
  url?: string
}

function patchPath(): string {
  return dshHomePath('cordis.patch.yml')
}

async function readPatchDocument(): Promise<Document.Parsed> {
  const path = patchPath()
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    const first = document.errors[0]
    throw new Error(`cannot parse ${path}: ${first?.message ?? 'unknown parse error'}`)
  }
  const value: unknown = document.toJS()
  if (value !== null && !Array.isArray(value)) throw new Error(`${path} must contain a YAML list`)
  return document
}

/** Whether a patch row is an mcp-client row. */
function isMcpRow(row: unknown): boolean {
  return typeof row === 'object' && row !== null && !Array.isArray(row)
    && (row as Record<string, unknown>)['name'] === MCP_PLUGIN
}

/** The serverName of an mcp-client row, or undefined. */
function serverNameOf(row: unknown): string | undefined {
  const config = (row as Record<string, unknown>)['config']
  if (typeof config !== 'object' || config === null) return undefined
  const name = (config as Record<string, unknown>)['serverName']
  return typeof name === 'string' ? name : undefined
}

/**
 * Add or replace one MCP server.
 * @param name - stable server name (`[A-Za-z0-9_-]{1,32}`).
 * @param options - transport choice and connection details.
 */
export async function addMcpServer(name: string, options: McpOptions): Promise<void> {
  if (!SERVER_NAME_PATTERN.test(name)) throw new Error(`mcp server name must match ${String(SERVER_NAME_PATTERN)}`)
  if (options.url === undefined && (options.command === undefined || options.command.trim() === '')) {
    throw new Error('mcp add needs --command <cmd> (stdio) or --url <url> (streamable-http)')
  }
  const config: Record<string, unknown> = { serverName: name }
  if (options.url === undefined) {
    config['transport'] = 'stdio'
    config['command'] = options.command?.trim() ?? ''
    config['args'] = options.args
  } else {
    config['transport'] = 'streamable-http'
    config['url'] = options.url
  }
  const path = patchPath()
  await mkdir(dshHomePath(), { recursive: true, mode: 0o700 })
  await withFileLock(path, async () => {
    const document = await readPatchDocument()
    const rows = ((document.toJS() as unknown[] | null) ?? [])
      .filter(row => !(isMcpRow(row) && serverNameOf(row) === name))
    rows.push({ id: `mcp-${name}`, name: MCP_PLUGIN, config })
    await writeFileAtomic(path, stringify(rows), { mode: 0o600, dirMode: 0o700 })
  })
  process.stdout.write(
    `Added MCP server ${name}`
    + (options.url === undefined ? ` (${options.command ?? ''})` : ` (${options.url})`)
    + '\n',
  )
}

/** The string value of a patch-config field, or empty for non-strings. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** List the configured MCP servers. */
export async function listMcpServers(): Promise<void> {
  const document = await readPatchDocument()
  const rows = ((document.toJS() as unknown[] | null) ?? []).filter(isMcpRow)
  if (rows.length === 0) {
    process.stdout.write('No MCP servers configured. Run `dsh mcp add <name> --command <cmd>` or `--url <url>`.\n')
    return
  }
  for (const row of rows) {
    const config = (row as { config: Record<string, unknown> }).config
    const name = textOf(config['serverName'])
    const transport = config['transport']
    process.stdout.write(`${name}\t${transport === 'streamable-http' ? textOf(config['url']) : textOf(config['command'])}\n`)
  }
}

/** One configured mcp-client row's config fields. */
interface McpRowConfig {
  serverName: string
  transport: string | undefined
  url: string | undefined
  command: string | undefined
  args: string[]
  headers: Record<string, string> | undefined
}

/** Resolve one server's config from the patch rows. */
async function configOf(name: string): Promise<McpRowConfig | undefined> {
  const document = await readPatchDocument()
  const rows = ((document.toJS() as unknown[] | null) ?? []).filter(isMcpRow)
  for (const row of rows) {
    const config = (row as { config: Record<string, unknown> }).config
    if (textOf(config['serverName']) !== name) continue
    return {
      serverName: name,
      transport: textOf(config['transport']),
      url: textOf(config['url']),
      command: textOf(config['command']),
      args: Array.isArray(config['args']) ? config['args'].map(textOf) : [],
      headers: typeof config['headers'] === 'object' && config['headers'] !== null
        ? Object.fromEntries(Object.entries(config['headers'] as Record<string, unknown>).map(([key, value]) => [key, textOf(value)]))
        : undefined,
    }
  }
  return undefined
}

/** Replace one server row's `headers` field under the home patch lock. */
async function updateHeaders(name: string, headers: Record<string, string> | undefined): Promise<void> {
  const path = patchPath()
  await withFileLock(path, async () => {
    const document = await readPatchDocument()
    const rows = ((document.toJS() as unknown[] | null) ?? []).map((row) => {
      if (!isMcpRow(row) || serverNameOf(row) !== name) return row
      const config = { ...(row as { config: Record<string, unknown> }).config }
      if (headers === undefined) {
        config['headers'] = undefined
      } else {
        config['headers'] = headers
      }
      return { ...(row as Record<string, unknown>), config }
    })
    await writeFileAtomic(path, stringify(rows), { mode: 0o600, dirMode: 0o700 })
  })
}

/**
 * Print one server's configuration.
 * @param name - server name written by a previous `mcp add`.
 */
export async function getMcpServer(name: string): Promise<void> {
  const config = await configOf(name)
  if (config === undefined) {
    process.stdout.write(`No MCP server named ${name}. Run \`dsh mcp list\` to see configured servers.\n`)
    return
  }
  process.stdout.write(`name: ${config.serverName}\n`)
  process.stdout.write(`transport: ${config.transport}\n`)
  if (config.url !== undefined) process.stdout.write(`url: ${config.url}\n`)
  if (config.command !== undefined) {
    process.stdout.write(`command: ${config.command}\n`)
    process.stdout.write(`args: ${config.args.join(' ')}\n`)
  }
  const headers = config.headers ?? {}
  if (Object.keys(headers).length === 0) {
    process.stdout.write('headers: (none)\n')
  } else {
    for (const [key, value] of Object.entries(headers)) {
      process.stdout.write(`header ${key}: ${key.toLowerCase() === 'authorization' ? '(set)' : value}\n`)
    }
  }
}

/**
 * Log one streamable-HTTP server in through the MCP Authorization browser
 * flow and store the bearer token on the server row.
 * @param name - server name written by a previous `mcp add --url`.
 */
export async function loginMcpServer(name: string): Promise<void> {
  const config = await configOf(name)
  if (config === undefined) {
    process.stdout.write(`No MCP server named ${name}. Run \`dsh mcp add <name> --url <url>\` first.\n`)
    return
  }
  if (config.transport !== 'streamable-http' || config.url === undefined || config.url === '') {
    throw new Error(`mcp login needs a streamable-http server; ${name} uses ${config.transport === undefined ? 'no' : config.transport} transport`)
  }
  const openCommand = process.env.DSH_MCP_OPEN_COMMAND
  const timeoutText = process.env.DSH_MCP_LOGIN_TIMEOUT_MS
  const timeoutMs = timeoutText === undefined || timeoutText === '' ? undefined : Number(timeoutText)
  const tokens = await runMcpOAuthLogin(config.url, {
    ...(openCommand === undefined ? {} : { openCommand }),
    ...(timeoutMs === undefined || !Number.isFinite(timeoutMs) ? {} : { timeoutMs }),
  })
  const stored = await readMcpAuth()
  stored[name] = {
    access_token: tokens.access_token,
    ...(tokens.refresh_token === undefined ? {} : { refresh_token: tokens.refresh_token }),
    token_type: tokens.token_type,
  }
  await writeMcpAuth(stored)
  const headers = { ...(config.headers ?? {}), Authorization: `Bearer ${tokens.access_token}` }
  await updateHeaders(name, headers)
  process.stdout.write(`Logged into MCP server ${name}.\n`)
}

/**
 * Remove the bearer token from one server row and its stored credentials.
 * @param name - server name written by a previous `mcp login`.
 */
export async function logoutMcpServer(name: string): Promise<void> {
  const stored = await readMcpAuth()
  const { [name]: _removed, ...keptTokens } = stored
  void _removed
  await writeMcpAuth(keptTokens)
  const config = await configOf(name)
  if (config === undefined) {
    process.stdout.write(`No MCP server named ${name}; stored credentials cleared.\n`)
    return
  }
  const headers = { ...(config.headers ?? {}) }
  const { Authorization: _authorization, authorization: _lowerAuthorization, ...keptHeaders } = headers
  void _authorization
  void _lowerAuthorization
  await updateHeaders(name, Object.keys(keptHeaders).length === 0 ? undefined : keptHeaders)
  process.stdout.write(`Logged out of MCP server ${name}.\n`)
}

/**
 * Remove one MCP server.
 * @param name - server name written by a previous `mcp add`.
 */
export async function removeMcpServer(name: string): Promise<void> {
  const path = patchPath()
  await withFileLock(path, async () => {
    const document = await readPatchDocument()
    const rows = ((document.toJS() as unknown[] | null) ?? [])
      .filter(row => !(isMcpRow(row) && serverNameOf(row) === name))
    await writeFileAtomic(path, stringify(rows), { mode: 0o600, dirMode: 0o700 })
  })
  process.stdout.write(`Removed MCP server ${name}\n`)
}
