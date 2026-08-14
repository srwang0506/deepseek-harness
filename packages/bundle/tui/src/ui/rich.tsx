/**
 * Rich (React) rendering for the terminal UI: Markdown and unified-diff text
 * rendered as Ink components, replacing the ANSI-string renderers.
 * @module @deepseek-ai/dsh-tui/ui/rich
 */

import React from 'react'
import { Box, Text } from 'ink'

/** Keyword vocabulary per language id (subset shared with the ANSI highlighter). */
const KEYWORDS: Record<string, ReadonlySet<string>> = {
  js: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'this', 'null', 'undefined', 'true', 'false', 'interface', 'type', 'enum']),
  ts: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'this', 'null', 'undefined', 'true', 'false', 'interface', 'type', 'enum', 'readonly']),
  python: new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'class', 'try', 'except', 'finally', 'with', 'lambda', 'pass', 'break', 'continue', 'not', 'and', 'or', 'in', 'is', 'None', 'True', 'False', 'yield', 'async', 'await', 'raise']),
  shell: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'export', 'local', 'cd', 'set', 'unset']),
  json: new Set(['true', 'false', 'null']),
}

const LINE_COMMENT: Record<string, string | undefined> = {
  js: '//', ts: '//', jsx: '//', tsx: '//', json: undefined,
  python: '#', py: '#', shell: '#', bash: '#', sh: '#', zsh: '#',
}

function blockComments(lang: string): boolean {
  return lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx'
}

/** Normalize a language hint to a known id, or undefined. */
function specFor(lang: string | undefined): { keywords: ReadonlySet<string>; comment: string | undefined; block: boolean } {
  const id = lang === undefined ? '' : lang.toLowerCase()
  const js = id === 'javascript' || id === 'jsx' ? 'js' : id === 'typescript' || id === 'tsx' ? 'ts' : id
  const py = id === 'py' ? 'python' : id
  const sh = id === 'bash' || id === 'sh' || id === 'zsh' || id === 'console' ? 'shell' : id
  const resolved = KEYWORDS[js] !== undefined ? js : KEYWORDS[py] !== undefined ? py : KEYWORDS[sh] !== undefined ? sh : id
  if (KEYWORDS[resolved] === undefined) return { keywords: new Set(), comment: undefined, block: false }
  return { keywords: KEYWORDS[resolved], comment: LINE_COMMENT[resolved], block: blockComments(resolved) }
}

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y
const NUMBER = /\b\d+(?:\.\d+)?\b/y
const WORD = /\b[A-Za-z_$][\w$]*\b/y

/** One colored code span. */
interface Token {
  text: string
  color: string | undefined
}

/** Tokenize one code line for syntax coloring. */
function highlightLine(line: string, spec: ReturnType<typeof specFor>): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < line.length) {
    if (spec.comment !== undefined && line.startsWith(spec.comment, index)) {
      tokens.push({ text: line.slice(index), color: 'grey' })
      return tokens
    }
    if (spec.block && line.startsWith('/*', index)) {
      const end = line.indexOf('*/', index + 2)
      if (end === -1) {
        tokens.push({ text: line.slice(index), color: 'grey' })
        return tokens
      }
      tokens.push({ text: line.slice(index, end + 2), color: 'grey' })
      index = end + 2
      continue
    }
    STRING.lastIndex = index
    const str = STRING.exec(line)
    if (str !== null) {
      tokens.push({ text: str[0], color: 'green' })
      index = STRING.lastIndex
      continue
    }
    NUMBER.lastIndex = index
    const num = NUMBER.exec(line)
    if (num !== null) {
      tokens.push({ text: num[0], color: 'yellow' })
      index = NUMBER.lastIndex
      continue
    }
    WORD.lastIndex = index
    const word = WORD.exec(line)
    if (word !== null) {
      const next = line[WORD.lastIndex]
      const color = spec.keywords.has(word[0]) ? 'magenta' : next === '(' ? 'blue' : undefined
      tokens.push({ text: word[0], color })
      index = WORD.lastIndex
      continue
    }
    tokens.push({ text: line[index] ?? '', color: undefined })
    index += 1
  }
  return tokens
}

/** Wrap text in an optional color. */
function span(text: string, color: string | undefined, key: number): React.ReactNode {
  return color === undefined ? <Text key={key}>{text}</Text> : <Text key={key} color={color}>{text}</Text>
}

/** A syntax-highlighted code block. */
function CodeBlock({ code, lang }: { code: string; lang: string }): React.JSX.Element {
  const spec = specFor(lang === '' ? undefined : lang)
  const lines = code.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Box key={index}>
          {highlightLine(line, spec).map((token, tokenIndex) => span(token.text, token.color, tokenIndex))}
        </Box>
      ))}
    </Box>
  )
}

const BOLD = /\*\*(?<text>[^*]+)\*\*/y
const LINK = /\[(?<text>[^\]]+)\]\((?<url>[^)]*)\)/y

/** Render one inline span: code spans first, then bold and links. */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const parts = text.split(/(`[^`]+`)/g)
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex] ?? ''
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      nodes.push(<Text key={partIndex} color="cyan">{part.slice(1, -1)}</Text>)
      continue
    }
    const out: React.ReactNode[] = []
    let index = 0
    while (index < part.length) {
      BOLD.lastIndex = index
      const bold = BOLD.exec(part)
      if (bold !== null && bold.groups !== undefined) {
        out.push(<Text key={`b${index}`} bold>{bold.groups['text'] ?? ''}</Text>)
        index = BOLD.lastIndex
        continue
      }
      LINK.lastIndex = index
      const link = LINK.exec(part)
      if (link !== null && link.groups !== undefined) {
        out.push(<Text key={`l${index}`}>{link.groups['text'] ?? ''}</Text>)
        const url = link.groups['url'] ?? ''
        if (url !== '') out.push(<Text key={`u${index}`} color="grey">{` (${url})`}</Text>)
        index = LINK.lastIndex
        continue
      }
      out.push(<Text key={`p${index}`}>{part[index]}</Text>)
      index += 1
    }
    nodes.push(...out)
  }
  return nodes
}

/** Render one block line (heading, list, quote, or plain inline). */
function renderBlockLine(line: string, key: number): React.ReactNode {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line)
  if (heading !== null) {
    return <Box key={key}><Text bold>{renderInline(heading[2] ?? '')}</Text></Box>
  }
  const unordered = /^\s*[-*]\s+(.*)$/.exec(line)
  if (unordered !== null) {
    return <Box key={key}><Text>{'  • '}{renderInline(unordered[1] ?? '')}</Text></Box>
  }
  const quote = /^\s*>\s?(.*)$/.exec(line)
  if (quote !== null) {
    return <Box key={key}><Text color="grey">{renderInline(quote[1] ?? '')}</Text></Box>
  }
  return <Box key={key}><Text>{renderInline(line)}</Text></Box>
}

/**
 * Render a Markdown string as Ink components: headings, lists, quotes, inline
 * bold/code/links, and syntax-highlighted fenced code blocks.
 */
export function MarkdownView({ text }: { text: string }): React.JSX.Element {
  const nodes: React.ReactNode[] = []
  let fence: string[] = []
  let fenceLang = ''
  let inFence = false
  let key = 0
  for (const line of text.split('\n')) {
    const fenceMarker = /^```(.*)$/.exec(line)
    if (fenceMarker !== null) {
      if (inFence) {
        nodes.push(<CodeBlock key={key++} code={fence.join('\n')} lang={fenceLang} />)
        fence = []
        fenceLang = ''
        inFence = false
      } else {
        inFence = true
        fenceLang = (fenceMarker[1] ?? '').trim()
      }
      continue
    }
    if (inFence) {
      fence.push(line)
      continue
    }
    nodes.push(renderBlockLine(line, key++))
  }
  if (inFence) nodes.push(<CodeBlock key={key++} code={fence.join('\n')} lang={fenceLang} />)
  return <Box flexDirection="column">{nodes}</Box>
}

/**
 * Render a unified diff as Ink components: insertions green, deletions red,
 * hunk headers cyan, file headers grey.
 */
export function DiffView({ text }: { text: string }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {text.split('\n').map((line, index) => {
        const color = line.startsWith('+') && !line.startsWith('+++') ? 'green'
          : line.startsWith('-') && !line.startsWith('---') ? 'red'
            : line.startsWith('@@') ? 'cyan'
              : line.startsWith('---') || line.startsWith('+++') ? 'grey'
                : undefined
        return span(line, color, index)
      })}
    </Box>
  )
}
