import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDoctor } from '../src/doctor.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Capture everything runDoctor writes to stdout. */
async function doctorOutput(): Promise<string> {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    chunks.push(String(chunk))
    return true
  }) as never)
  try {
    await runDoctor()
  } finally {
    spy.mockRestore()
  }
  return chunks.join('')
}

describe('runDoctor', () => {
  it('reports node, key, home, and openai state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test')

    const output = await doctorOutput()

    expect(output).toContain('✓ node:')
    expect(output).toContain('✓ DEEPSEEK_API_KEY: set')
    expect(output).toContain('✓ home:')
    expect(output).toContain('openai: not logged in')
  })

  it('flags a missing API key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-'))
    roots.push(root)
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DEEPSEEK_API_KEY', '')

    const output = await doctorOutput()

    expect(output).toContain('✗ DEEPSEEK_API_KEY: missing')
  })
})
