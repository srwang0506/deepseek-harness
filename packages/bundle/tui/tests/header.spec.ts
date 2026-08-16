/** Session-header helpers: version resolution and home relativization. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { appVersion, centerTruncate, relativizeHome } from '../src/header.ts'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/user') }))

const readFileSyncMock = vi.mocked(readFileSync)
const homedirMock = vi.mocked(homedir)

beforeEach(() => { homedirMock.mockReturnValue('/home/user') })

afterEach(() => {
  vi.unstubAllEnvs()
  readFileSyncMock.mockReset()
})

describe('appVersion', () => {
  it('returns DSH_VERSION when set', () => {
    vi.stubEnv('DSH_VERSION', '9.9.9')
    expect(appVersion()).toBe('9.9.9')
  })

  it('falls back to the manifest version when DSH_VERSION is empty', () => {
    vi.stubEnv('DSH_VERSION', '')
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: '1.2.3' }))
    expect(appVersion()).toBe('1.2.3')
  })

  it('returns the zero version when the manifest version is not a string', () => {
    vi.stubEnv('DSH_VERSION', '')
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: 42 }))
    expect(appVersion()).toBe('0.0.0')
  })

  it('returns the zero version when the manifest cannot be read', () => {
    vi.stubEnv('DSH_VERSION', '')
    readFileSyncMock.mockImplementation(() => { throw new Error('boom') })
    expect(appVersion()).toBe('0.0.0')
  })
})

describe('centerTruncate', () => {
  it('returns the text unchanged when it fits', () => {
    expect(centerTruncate('short', 10)).toBe('short')
  })

  it('center-truncates a long path so both ends stay visible', () => {
    expect(centerTruncate('/very/long/path/that/overflows/the/card/width', 20)).toBe('/very/long…ard/width')
  })

  it('center-truncates to an even budget', () => {
    expect(centerTruncate('abcdefghij', 5)).toBe('ab…ij')
  })
})

describe('relativizeHome', () => {
  it('relativizes a home subdirectory to ~', () => {
    expect(relativizeHome(`/home/user${sep}src${sep}app`)).toBe(`~${sep}src${sep}app`)
  })

  it('relativizes the home directory itself to ~', () => {
    expect(relativizeHome('/home/user')).toBe('~')
  })

  it('leaves a directory outside home unchanged', () => {
    expect(relativizeHome(`/tmp${sep}other`)).toBe(`/tmp${sep}other`)
  })

  it('keeps the prefix single when home already ends in a separator', () => {
    homedirMock.mockReturnValue(`/home/user${sep}`)
    expect(relativizeHome(`/home/user${sep}project`)).toBe(`~${sep}project`)
  })
})
