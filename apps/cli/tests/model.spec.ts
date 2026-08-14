import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectModel } from '../src/model.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('selectModel', () => {
  it('writes the agent-default-model selection and preserves unrelated settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-model-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    await writeFile(join(root, 'settings.yaml'), 'ui-onboarding:\n  modelSelection: true\n')

    await selectModel(['gpt', 'gpt-5.6-sol', 'xhigh'])

    const settings = await readFile(join(root, 'settings.yaml'), 'utf8')
    expect(settings).toContain('modelSelection: true')
    expect(settings).toContain('provider: openai-codex')
    expect(settings).toContain('model: gpt-5.6-sol')
    expect(settings).toContain('reasoningEffort: xhigh')
  })

  it('rejects an unknown model family', async () => {
    await expect(selectModel(['anthropic'])).rejects.toThrow('model must be deepseek, gpt, or status')
  })
})
