/**
 * Lightweight Markdown-to-ANSI rendering for assistant text. Deliberately a
 * subset, not a parser: fenced code blocks (syntax-highlighted), ATX headings,
 * block quotes, unordered/ordered lists, inline code, bold, and links. The
 * output is terminal text; anything unrecognized passes through unchanged.
 * @module @deepseek-ai/dsh-tui/markdown
 */

import { highlight } from './highlight.ts'
import { bold, cyan, dim, grey, magenta } from './theme.ts'

/** Sticky patterns match at the scanner's current index only. */
const BOLD = /\*\*([^*]+)\*\*/y
const LINK = /\[([^\]]+)\]\(([^)]*)\)/y

/**
 * Style one non-code inline span: bold and links only (italic is left plain —
 * its single-asterisk syntax collides with list bullets and arithmetic).
 * @param text - inline text with code spans already removed.
 * @returns the styled span.
 */
function renderInline(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    BOLD.lastIndex = index
    const boldMatch = BOLD.exec(text)
    if (boldMatch !== null) {
      out += bold(boldMatch[1] ?? '')
      index = BOLD.lastIndex
      continue
    }
    LINK.lastIndex = index
    const linkMatch = LINK.exec(text)
    if (linkMatch !== null) {
      const linkText = linkMatch[1] ?? ''
      const linkUrl = linkMatch[2] ?? ''
      out += linkText
      if (linkUrl !== '') out += ` ${grey(`(${linkUrl})`)}`
      index = LINK.lastIndex
      continue
    }
    out += text[index] ?? ''
    index += 1
  }
  return out
}

/**
 * Style one inline text span, honoring code spans before bold/links.
 * @param text - one line's inline content.
 * @returns the styled line.
 */
function renderInlineFull(text: string): string {
  return text.split(/(`[^`]+`)/g)
    .map(part => (part.startsWith('`') && part.endsWith('`') && part.length > 1
      ? cyan(part.slice(1, -1))
      : renderInline(part)))
    .join('')
}

/**
 * Render one non-fence source line.
 * @param line - the line without its newline.
 * @returns the styled line.
 */
function renderLine(line: string): string {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line)
  if (heading !== null) return bold(renderInlineFull(heading[2] ?? ''))
  const unordered = /^\s*[-*]\s+(.*)$/.exec(line)
  if (unordered !== null) return `  ${magenta('•')} ${renderInlineFull(unordered[1] ?? '')}`
  const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
  if (ordered !== null) return `  ${ordered[0].match(/^\s*\d+[.)]/)?.[0] ?? ''} ${renderInlineFull(ordered[1] ?? '')}`
  const quote = /^\s*>\s?(.*)$/.exec(line)
  if (quote !== null) return dim(renderInlineFull(quote[1] ?? ''))
  return renderInlineFull(line)
}

/**
 * Render the collected lines of one fenced code block.
 * @param code - the block's lines without fence markers.
 * @param lang - the declared language hint, or empty.
 * @returns the highlighted block.
 */
function renderCodeBlock(code: readonly string[], lang: string): string {
  const trimmed = [...code]
  while (trimmed.length > 0 && trimmed.at(-1) === '') trimmed.pop()
  const body = trimmed.join('\n')
  return body === '' ? '' : highlight(body, lang === '' ? undefined : lang)
}

/**
 * Incremental Markdown-to-ANSI assembler for streaming text. It buffers until
 * a complete line, then renders it (closing fenced code blocks as a unit), so
 * live output is line-oriented but still styled.
 */
export class MarkdownStream {
  private buffer = ''
  private fence: string[] = []
  private fenceLang = ''
  private inFence = false

  /**
   * Append one stream delta and return the rendered text for every completed
   * line (each newline-terminated); the trailing partial line stays buffered.
   * @param text - the next text delta.
   * @returns rendered complete lines, or an empty string when none completed.
   */
  push(text: string): string {
    this.buffer += text
    let out = ''
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      out += this.acceptLine(line)
      index = this.buffer.indexOf('\n')
    }
    return out
  }

  /**
   * Render the trailing partial line (or an unterminated code fence) and reset
   * the assembler for the next turn.
   * @returns the rendered remainder, newline-terminated (or empty).
   */
  flush(): string {
    const line = this.buffer
    this.buffer = ''
    if (this.inFence) {
      if (line !== '') this.fence.push(line)
      const code = renderCodeBlock(this.fence, this.fenceLang)
      this.fence = []
      this.fenceLang = ''
      this.inFence = false
      return code === '' ? '' : `${code}\n`
    }
    return line === '' ? '' : `${renderLine(line)}\n`
  }

  private acceptLine(line: string): string {
    const fenceMarker = /^```(.*)$/.exec(line)
    if (fenceMarker !== null) {
      if (this.inFence) {
        this.inFence = false
        const code = renderCodeBlock(this.fence, this.fenceLang)
        this.fence = []
        this.fenceLang = ''
        return code === '' ? '\n' : `${code}\n`
      }
      this.inFence = true
      this.fenceLang = (fenceMarker[1] ?? '').trim()
      return ''
    }
    if (this.inFence) {
      this.fence.push(line)
      return ''
    }
    return `${renderLine(line)}\n`
  }
}

/**
 * Render a Markdown string as ANSI-styled terminal text.
 * @param md - the Markdown source.
 * @returns the styled text, without a trailing newline.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = []
  let fence: string[] = []
  let fenceLang = ''
  let inFence = false
  for (const line of md.split('\n')) {
    const fenceMarker = /^```(.*)$/.exec(line)
    if (fenceMarker !== null) {
      if (inFence) {
        out.push(renderCodeBlock(fence, fenceLang))
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
    out.push(renderLine(line))
  }
  if (inFence) out.push(renderCodeBlock(fence, fenceLang))
  return out.join('\n')
}
