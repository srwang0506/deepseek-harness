import { describe, expect, it } from 'vitest'
import { parseSlash } from '../src/slash.ts'

describe('parseSlash', () => {
  it('splits a command name from its arguments', () => {
    expect(parseSlash('/resume abc')).toEqual({ name: 'resume', args: 'abc' })
    expect(parseSlash('/new')).toEqual({ name: 'new', args: '' })
    expect(parseSlash('/model deepseek-chat')).toEqual({ name: 'model', args: 'deepseek-chat' })
    expect(parseSlash('/RESUME abc')).toEqual({ name: 'resume', args: 'abc' })
  })

  it('returns undefined for plain input or a bare slash', () => {
    expect(parseSlash('hello')).toBeUndefined()
    expect(parseSlash('/')).toBeUndefined()
    expect(parseSlash('/   ')).toBeUndefined()
  })
})
