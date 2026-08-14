/**
 * Lightweight, dependency-free syntax highlighting for the terminal. A
 * language gets a keyword set and a comment style; the shared scanner colors
 * comments, strings, numbers, keywords, and call-shaped identifiers. Unknown
 * languages pass through uncolored.
 * @module @deepseek-ai/dsh-tui/highlight
 */

import { bold, dim, green, magenta, yellow } from './theme.ts'

/** Keyword vocabulary per language id. */
const KEYWORDS: Record<string, ReadonlySet<string>> = {
  js: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false', 'yield', 'delete', 'void', 'static', 'get', 'set', 'default', 'interface', 'type', 'enum']),
  ts: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'implements', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false', 'yield', 'delete', 'void', 'static', 'get', 'set', 'default', 'interface', 'type', 'enum', 'readonly', 'private', 'public', 'protected', 'abstract', 'declare']),
  python: new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'with', 'lambda', 'pass', 'break', 'continue', 'not', 'and', 'or', 'in', 'is', 'None', 'True', 'False', 'yield', 'async', 'await', 'del', 'global', 'nonlocal', 'raise', 'assert']),
  shell: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'export', 'local', 'readonly', 'source', 'cd', 'set', 'unset', 'shift']),
  json: new Set(['true', 'false', 'null']),
}

/** Line-comment introducers per language family; `undefined` means none. */
const LINE_COMMENT: Record<string, string | undefined> = {
  js: '//', ts: '//', jsx: '//', tsx: '//', json: undefined,
  python: '#', py: '#', shell: '#', bash: '#', sh: '#', zsh: '#',
}

/** Whether a language supports `/* block comments *​/`. */
function blockComments(lang: string): boolean {
  return lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx'
}

/** Normalize a language hint to a known id, or undefined. */
function specFor(lang: string | undefined): { keywords: ReadonlySet<string>; comment: string | undefined; block: boolean } {
  const id = lang === undefined ? '' : lang.toLowerCase()
  const js = id === 'javascript' || id === 'jsx' ? 'js' : id === 'typescript' || id === 'tsx' ? 'ts' : id
  const py = id === 'py' ? 'python' : id
  const sh = id === 'bash' || id === 'sh' || id === 'zsh' || id === 'console' || id === 'terminal' ? 'shell' : id
  const resolved = KEYWORDS[js] !== undefined ? js : KEYWORDS[py] !== undefined ? py : KEYWORDS[sh] !== undefined ? sh : id
  if (KEYWORDS[resolved] === undefined) return { keywords: new Set(), comment: undefined, block: false }
  return { keywords: KEYWORDS[resolved], comment: LINE_COMMENT[resolved], block: blockComments(resolved) }
}

/** Sticky token patterns, applied left-to-right at each position. */
const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y
const NUMBER = /\b\d+(?:\.\d+)?\b/y
const WORD = /\b[A-Za-z_$][\w$]*\b/y

/** One line's highlighted text plus whether a block comment remains open. */
interface HighlightResult {
  text: string
  inBlock: boolean
}

/**
 * Color one source line according to a resolved language spec.
 * @param line - one line without its newline.
 * @param spec - the resolved keyword/comment configuration.
 * @param inBlock - whether a `/* ... *​/` comment was open entering this line.
 * @returns the highlighted line and the block-comment state to carry forward.
 */
function highlightLine(line: string, spec: ReturnType<typeof specFor>, inBlock: boolean): HighlightResult {
  let out = ''
  let index = 0
  while (index < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', index)
      if (end === -1) {
        out += dim(line.slice(index))
        return { text: out, inBlock: true }
      }
      out += dim(line.slice(index, end + 2))
      index = end + 2
      inBlock = false
      continue
    }
    if (spec.comment !== undefined && line.startsWith(spec.comment, index)) {
      out += dim(line.slice(index))
      return { text: out, inBlock: false }
    }
    if (spec.block && line.startsWith('/*', index)) {
      const end = line.indexOf('*/', index + 2)
      if (end === -1) {
        out += dim(line.slice(index))
        return { text: out, inBlock: true }
      }
      out += dim(line.slice(index, end + 2))
      index = end + 2
      continue
    }
    STRING.lastIndex = index
    const str = STRING.exec(line)
    if (str !== null) {
      out += green(str[0])
      index = STRING.lastIndex
      continue
    }
    NUMBER.lastIndex = index
    const num = NUMBER.exec(line)
    if (num !== null) {
      out += yellow(num[0])
      index = NUMBER.lastIndex
      continue
    }
    WORD.lastIndex = index
    const word = WORD.exec(line)
    if (word !== null) {
      const next = line[WORD.lastIndex]
      if (spec.keywords.has(word[0])) out += magenta(word[0])
      else if (next === '(') out += bold(word[0])
      else out += word[0]
      index = WORD.lastIndex
      continue
    }
    out += line[index] ?? ''
    index += 1
  }
  return { text: out, inBlock }
}

/**
 * Syntax-highlight a code string for the terminal.
 * @param code - the source text.
 * @param lang - optional language hint (e.g. `ts`, `python`, `bash`).
 * @returns the highlighted text.
 */
export function highlight(code: string, lang?: string): string {
  const spec = specFor(lang)
  let inBlock = false
  return code.split('\n').map((line) => {
    const result = highlightLine(line, spec, inBlock)
    inBlock = result.inBlock
    return result.text
  }).join('\n')
}
