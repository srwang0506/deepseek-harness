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
import { parseDocument, stringify } from 'yaml'
import type { Document } from 'yaml'

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
