import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateTarget } from '../src/update.ts'

afterEach(() => { vi.unstubAllEnvs() })

describe('updateTarget', () => {
  it('resolves the platform scenario from process.platform/arch', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin', arch: 'arm64' })
    expect(updateTarget()).toBe('macos-cli')
    vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'x64' })
    expect(updateTarget()).toBe('linux-x64')
    vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'arm64' })
    expect(updateTarget()).toBe('linux-arm64')
    vi.stubGlobal('process', { ...process, platform: 'win32', arch: 'x64' })
    expect(updateTarget()).toBe('windows-x64')
  })
})
