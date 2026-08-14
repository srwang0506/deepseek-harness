import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addProvider, removeProvider } from '../src/provider.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('provider routes', () => {
  it('adds a catalog route with only its API-key env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-provider-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await addProvider('anthropic', { apiKeyEnv: 'ANTHROPIC_API_KEY' })

    const settings = await readFile(join(root, 'settings.yaml'), 'utf8')
    expect(settings).toContain('llm-pi-ai')
    expect(settings).toContain('anthropic')
    expect(settings).toContain('apiKeyEnv: ANTHROPIC_API_KEY')
    expect(settings).not.toContain('baseURL')
  })

  it('adds a custom OpenAI-compatible endpoint with a model entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-provider-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await addProvider('gateway', { apiKeyEnv: 'GATEWAY_KEY', baseURL: 'https://gateway.example/v1', model: 'gpt-4o' })

    const settings = await readFile(join(root, 'settings.yaml'), 'utf8')
    expect(settings).toContain('baseURL: https://gateway.example/v1')
    expect(settings).toContain('api: openai-completions')
    expect(settings).toContain('id: gpt-4o')
  })

  it('rejects a custom endpoint without a model id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-provider-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await expect(addProvider('gateway', { apiKeyEnv: 'GATEWAY_KEY', baseURL: 'https://gateway.example/v1' }))
      .rejects.toThrow('a custom endpoint needs --model <id>')
  })

  it('removes a configured route', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-provider-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)

    await addProvider('anthropic', { apiKeyEnv: 'ANTHROPIC_API_KEY' })
    await removeProvider('anthropic')

    const settings = await readFile(join(root, 'settings.yaml'), 'utf8')
    expect(settings).not.toContain('anthropic')
  })
})
