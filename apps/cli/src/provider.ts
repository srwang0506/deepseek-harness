/**
 * pi-ai provider route management for the `dsh` CLI.
 *
 * Provider routes live in the `llm-pi-ai` settings section of
 * `$DSH_HOME/settings.yaml`, the same document the web Models page edits. A
 * catalog route (openai, anthropic, gemini, …) only needs its API-key
 * environment variable; a custom OpenAI-compatible endpoint additionally
 * declares `api`, `baseURL`, and one model entry.
 * @module @deepseek-ai/dsh/provider
 */

import { mkdir, readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import type { Document } from 'yaml'

/** Settings namespace the `llm-pi-ai` plugin reads its provider profiles from. */
const NAMESPACE = 'llm-pi-ai'

/** Context window and output budget written for a custom endpoint's model. */
const CUSTOM_MODEL_DEFAULTS = { contextWindow: 131072, maxTokens: 8192 }

/** Options accepted by `dsh provider add`. */
export interface ProviderOptions {
  /** Environment variable (or credential ref) holding the provider API key. */
  apiKeyEnv: string
  /** Custom OpenAI-compatible base URL; absent means a pi-ai catalog route. */
  baseURL?: string
  /** Model id for a custom endpoint; required together with `baseURL`. */
  model?: string
  /** User-facing route name. */
  displayName?: string
}

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

/**
 * Configure one pi-ai provider route.
 * @param name - route id; a pi-ai catalog id, or any name for a custom endpoint.
 * @param options - route options; `baseURL` selects the custom-endpoint form.
 */
export async function addProvider(name: string, options: ProviderOptions): Promise<void> {
  if (name.trim() === '') throw new Error('provider needs a name')
  if (options.apiKeyEnv.trim() === '') throw new Error('provider needs --api-key-env')
  const baseURL = options.baseURL
  const profile: Record<string, unknown> = { apiKeyEnv: options.apiKeyEnv.trim() }
  if (options.displayName !== undefined) profile['displayName'] = options.displayName
  if (baseURL !== undefined) {
    const model = options.model?.trim() ?? ''
    if (model === '') throw new Error('a custom endpoint needs --model <id>')
    profile['api'] = 'openai-completions'
    profile['baseURL'] = baseURL
    profile['models'] = [{ id: model, ...CUSTOM_MODEL_DEFAULTS }]
  }
  const path = settingsPath()
  await mkdir(dshHomePath(), { recursive: true, mode: 0o700 })
  await withFileLock(path, async () => {
    const document = await readSettingsDocument()
    document.setIn([NAMESPACE, 'providers', name.trim()], profile)
    await writeFileAtomic(path, String(document), { mode: 0o600, dirMode: 0o700 })
  })
  process.stdout.write(
    `Configured provider ${name.trim()}`
    + (baseURL === undefined ? '' : ` -> ${baseURL}`)
    + ` (apiKeyEnv ${options.apiKeyEnv.trim()})\n`,
  )
}

/** List the configured pi-ai provider routes. */
export async function listProviders(): Promise<void> {
  const document = await readSettingsDocument()
  const value = document.toJS() as { [key: string]: unknown } | null
  const section = value?.[NAMESPACE] as { providers?: Record<string, unknown> } | undefined
  const providers = section?.providers
  if (providers === undefined || Object.keys(providers).length === 0) {
    process.stdout.write(
      'No configured pi-ai providers. Run `dsh provider add <name> --api-key-env <ENV>`'
      + ' to enable a catalog route (openai, anthropic, gemini, …), or add'
      + ' `--base-url <url> --model <id>` for a custom OpenAI-compatible endpoint.\n',
    )
    return
  }
  for (const [name, profile] of Object.entries(providers)) {
    const candidate = profile as Record<string, unknown> | null
    const apiKeyEnv = typeof candidate?.['apiKeyEnv'] === 'string' ? candidate['apiKeyEnv'] : ''
    const baseURL = typeof candidate?.['baseURL'] === 'string' ? ` baseURL=${candidate['baseURL']}` : ''
    process.stdout.write(`${name}\tapiKeyEnv=${apiKeyEnv}${baseURL}\n`)
  }
}

/**
 * Remove one configured pi-ai provider route.
 * @param name - route id written by a previous `provider add`.
 */
export async function removeProvider(name: string): Promise<void> {
  if (name.trim() === '') throw new Error('provider needs a name')
  const path = settingsPath()
  await withFileLock(path, async () => {
    const document = await readSettingsDocument()
    document.deleteIn([NAMESPACE, 'providers', name.trim()])
    await writeFileAtomic(path, String(document), { mode: 0o600, dirMode: 0o700 })
  })
  process.stdout.write(`Removed provider ${name.trim()}\n`)
}
