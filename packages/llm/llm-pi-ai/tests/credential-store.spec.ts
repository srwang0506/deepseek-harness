import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Credential } from '@earendil-works/pi-ai'
import { PiAiCredentialStore } from '../src/credential-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function store(): Promise<{ root: string; path: string; store: PiAiCredentialStore }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pi-auth-'))
  roots.push(root)
  const path = join(root, 'private', 'auth.json')
  return { root, path, store: new PiAiCredentialStore(path) }
}

const oauth: Credential = {
  type: 'oauth',
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1_900_000_000_000,
  accountId: 'account',
}

describe('PiAiCredentialStore', () => {
  it('treats a missing document as empty and preserves modify-without-change', async () => {
    const { store: credentials } = await store()
    expect(await credentials.read('openai-codex')).toBeUndefined()
    expect(await credentials.list()).toEqual([])
    await expect(credentials.modify('openai-codex', current => Promise.resolve(current))).resolves.toBeUndefined()
  })

  it('persists OAuth and API-key credentials with owner-only permissions', async () => {
    const { path, store: credentials } = await store()
    await credentials.modify('openai-codex', () => Promise.resolve(oauth))
    await credentials.modify('openai', () => Promise.resolve({
      type: 'api_key',
      key: 'sk-test',
      env: { OPENAI_ORG_ID: 'org' },
    }))

    expect(await credentials.read('openai-codex')).toEqual(oauth)
    expect(await credentials.list()).toEqual([
      { providerId: 'openai-codex', type: 'oauth' },
      { providerId: 'openai', type: 'api_key' },
    ])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      'openai-codex': { type: 'oauth', access: 'access-token' },
      openai: { type: 'api_key', key: 'sk-test' },
    })
  })

  it('serializes writers from separate store instances and deletes idempotently', async () => {
    const { path, store: first } = await store()
    const second = new PiAiCredentialStore(path)
    await Promise.all([
      first.modify('openai-codex', async () => oauth),
      second.modify('openai', async () => ({ type: 'api_key', key: 'sk-other' })),
    ])
    expect((await first.list()).map(entry => entry.providerId).sort()).toEqual(['openai', 'openai-codex'])

    await first.delete('openai-codex')
    await first.delete('openai-codex')
    expect(await second.read('openai-codex')).toBeUndefined()
    expect(await second.read('openai')).toEqual({ type: 'api_key', key: 'sk-other' })
  })

  it('releases the writer lock when a mutation rejects', async () => {
    const { store: credentials } = await store()
    await expect(credentials.modify('openai-codex', async () => {
      throw new Error('refused')
    })).rejects.toThrow('refused')
    await expect(credentials.modify('openai-codex', async () => oauth)).resolves.toEqual(oauth)
  })

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['an array', '[]', /must contain an object/],
    ['a scalar entry', '{"openai":1}', /must be an object/],
    ['a malformed API key', '{"openai":{"type":"api_key","key":1}}', /invalid API key/],
    ['malformed provider environment', '{"openai":{"type":"api_key","env":{"A":1}}}', /invalid provider environment/],
    ['a malformed OAuth credential', '{"openai-codex":{"type":"oauth","access":"a","refresh":"r","expires":"later"}}', /invalid credential type or fields/],
  ])('refuses %s at the file boundary', async (_label, source, pattern) => {
    const { path, store: credentials } = await store()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, source)
    await expect(credentials.list()).rejects.toThrow(pattern)
  })
})
