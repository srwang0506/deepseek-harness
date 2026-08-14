/**
 * Default-agent-model selection for the `dsh` CLI.
 *
 * The selection is one `agent-default-model` entry in `$DSH_HOME/settings.yaml`,
 * the same settings document the `dsh-agent-default-model` plugin resolves at
 * each step's prompt assembly. Writes go through the repository's file-lock
 * protocol so a running session never observes a half-written document.
 * @module @deepseek-ai/dsh/model
 */

import { mkdir, readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import type { Document } from 'yaml'

/** DeepSeek default selection written by `model deepseek`. */
interface DeepSeekSelection {
  provider: 'deepseek-official'
  model: 'deepseek-v4-flash'
}

/** OpenAI GPT selection written by `model gpt`. */
interface GptSelection {
  provider: 'openai-codex'
  model: string
  reasoningEffort: string
}

type ModelSelection = DeepSeekSelection | GptSelection

/** Resolve the settings document at call time so a `DSH_HOME` override applies per invocation. */
function settingsPath(): string {
  return dshHomePath('settings.yaml')
}

async function readSettingsDocument(): Promise<Document.Parsed> {
  const path = settingsPath()
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    const first = document.errors[0]
    throw new Error(`cannot parse ${path}: ${first?.message ?? 'unknown parse error'}`)
  }
  const value: unknown = document.toJS()
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`${path} must contain a YAML mapping`)
  }
  return document
}

async function saveModel(selection: ModelSelection): Promise<void> {
  const path = settingsPath()
  await mkdir(dshHomePath(), { recursive: true, mode: 0o700 })
  await withFileLock(path, async () => {
    const document = await readSettingsDocument()
    document.setIn(['agent-default-model'], selection)
    await writeFileAtomic(path, String(document), { mode: 0o600, dirMode: 0o700 })
  })
  process.stdout.write(
    `Selected ${selection.provider}/${selection.model}`
    + (selection.provider === 'openai-codex' ? ` (${selection.reasoningEffort})` : '')
    + '\n',
  )
}

async function showModel(): Promise<void> {
  const path = settingsPath()
  const document = await readSettingsDocument()
  const settings: unknown = document.toJS()
  const selection = (settings as { 'agent-default-model'?: unknown } | null)?.['agent-default-model']
  if (selection === undefined || selection === null) {
    process.stdout.write('Selected deepseek-official/deepseek-v4-flash (installation default)\n')
    return
  }
  if (typeof selection !== 'object' || Array.isArray(selection)) {
    throw new Error(`${path} has an invalid agent-default-model section`)
  }
  const candidate = selection as Record<string, unknown>
  if (typeof candidate['provider'] !== 'string' || typeof candidate['model'] !== 'string') {
    throw new Error(`${path} has an invalid agent-default-model section`)
  }
  const reasoning = candidate['reasoningEffort']
  process.stdout.write(
    `Selected ${candidate['provider']}/${candidate['model']}`
    + (typeof reasoning === 'string' ? ` (${reasoning})` : '')
    + '\n',
  )
}

/**
 * Select or show the default agent model.
 * @param args - `[family, modelId?, reasoningEffort?]`; empty (or `status`) shows the current selection.
 */
export async function selectModel(args: readonly string[]): Promise<void> {
  if (args.length > 3) throw new Error('model accepts at most a family, model id, and reasoning effort')
  const [family, modelId, reasoningEffort] = args
  if (family === undefined || family === 'status') return showModel()
  if (family === 'deepseek') {
    if (modelId !== undefined || reasoningEffort !== undefined) throw new Error('model deepseek takes no additional arguments')
    return saveModel({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  }
  if (family === 'gpt') {
    return saveModel({
      provider: 'openai-codex',
      model: modelId ?? 'gpt-5.6-sol',
      reasoningEffort: reasoningEffort ?? 'high',
    })
  }
  throw new Error('model must be deepseek, gpt, or status')
}
