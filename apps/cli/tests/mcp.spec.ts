import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addMcpServer, getMcpServer, logoutMcpServer, removeMcpServer } from '../src/mcp.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('MCP server inspection and logout', () => {
  it('prints a configured server and masks its bearer header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    await addMcpServer('http-server', { args: [], url: 'https://mcp.example.com' })
    await writeFile(join(root, 'cordis.patch.yml'), (await readFile(join(root, 'cordis.patch.yml'), 'utf8')).replace(
      'url: https://mcp.example.com',
      'url: https://mcp.example.com\n    headers:\n      Authorization: Bearer secret-token',
    ))
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await getMcpServer('http-server')
    expect(out.mock.calls.map(call => String(call[0])).join('')).toContain('header Authorization: (set)')
    expect(out.mock.calls.map(call => String(call[0])).join('')).not.toContain('secret-token')
  })

  it('reports a missing server on get without writing anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await getMcpServer('absent')
    expect(out.mock.calls.map(call => String(call[0])).join('')).toContain('No MCP server named absent')
  })

  it('logout clears the bearer header and tolerates an absent server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    await addMcpServer('http-server', { args: [], url: 'https://mcp.example.com' })
    await writeFile(join(root, 'cordis.patch.yml'), (await readFile(join(root, 'cordis.patch.yml'), 'utf8')).replace(
      'url: https://mcp.example.com',
      'url: https://mcp.example.com\n    headers:\n      Authorization: Bearer secret-token',
    ))
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await logoutMcpServer('http-server')
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain('Authorization')
    await logoutMcpServer('absent')
    expect(out.mock.calls.map(call => String(call[0])).join('')).toContain('stored credentials cleared')
  })
})

describe('MCP server management', () => {
  it('adds a stdio server and preserves unrelated patch rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    await writeFile(join(root, 'cordis.patch.yml'), '- id: other\n  name: "@deepseek-ai/dsh-something"\n')

    await addMcpServer('github', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })

    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('@deepseek-ai/dsh-something')
    expect(patch).toContain('serverName: github')
    expect(patch).toContain('command: npx')
    expect(patch).toContain('- -y')
  })

  it('adds a streamable-http server and replaces a same-named row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await addMcpServer('fetch', { args: [], command: 'old' })
    await addMcpServer('fetch', { args: [], url: 'https://mcp.example.com' })

    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain('command: old')
    expect(patch).toContain('url: https://mcp.example.com')
    expect(patch.match(/serverName: fetch/g)).toHaveLength(1)
  })

  it('removes a configured server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await addMcpServer('github', { command: 'npx', args: [] })
    await removeMcpServer('github')

    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain('serverName: github')
  })

  it('rejects an invalid server name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await expect(addMcpServer('bad name!', { command: 'x', args: [] })).rejects.toThrow(/name must match/)
  })
})
