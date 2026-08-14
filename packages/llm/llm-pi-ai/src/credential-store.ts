/**
 * Persistent pi-ai credentials stored as one owner-only JSON document.
 * Readers stay lock-free because every write replaces the complete document
 * atomically; cross-process writers share the repository's file-lock protocol,
 * so OAuth login and request-time token refresh cannot overwrite each other.
 * @module dsh-llm-pi-ai/credential-store
 */

import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A parsed credential document keyed by pi-ai provider id. */
type CredentialDocument = Record<string, Credential>

/** Whether an unknown value is a string dictionary. */
function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(member => typeof member === 'string')
}

/** Validate one credential read from the secret-bearing file boundary. */
function credential(value: unknown, providerId: string): Credential {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`llm-pi-ai: credential store entry "${providerId}" must be an object`)
  }
  const candidate = value as Record<string, unknown>
  if (candidate['type'] === 'api_key') {
    if (candidate['key'] !== undefined && typeof candidate['key'] !== 'string') {
      throw new Error(`llm-pi-ai: credential store entry "${providerId}" has an invalid API key`)
    }
    if (candidate['env'] !== undefined && !isStringRecord(candidate['env'])) {
      throw new Error(`llm-pi-ai: credential store entry "${providerId}" has invalid provider environment values`)
    }
    return value as Credential
  }
  if (candidate['type'] === 'oauth'
    && typeof candidate['access'] === 'string'
    && typeof candidate['refresh'] === 'string'
    && typeof candidate['expires'] === 'number'
    && Number.isFinite(candidate['expires'])) {
    return value as Credential
  }
  throw new Error(`llm-pi-ai: credential store entry "${providerId}" has an invalid credential type or fields`)
}

/** Parse the complete JSON credential document. */
function parseDocument(source: string, path: string): CredentialDocument {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`llm-pi-ai: credential store at ${path} is not valid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`llm-pi-ai: credential store at ${path} must contain an object`)
  }
  return Object.fromEntries(
    Object.entries(value).map(([providerId, stored]) => [providerId, credential(stored, providerId)]),
  )
}

/**
 * File-backed pi-ai credential storage compatible with its `auth.json` value
 * format. The containing directory is owner-only and the document is mode
 * `0600`; no method returns secrets while enumerating account status.
 */
export class PiAiCredentialStore implements CredentialStore {
  constructor(readonly path: string) {}

  /** Read the current complete document; a missing file is an empty store. */
  private async document(): Promise<CredentialDocument> {
    try {
      return parseDocument(await readFile(this.path, 'utf8'), this.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  /** Commit one complete document with private permissions. */
  private write(document: CredentialDocument): Promise<void> {
    return writeFileAtomic(this.path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }

  /** Read one stored credential without refreshing it. */
  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.document())[providerId]
  }

  /** List only non-secret provider/type metadata. */
  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(await this.document()).map(([providerId, stored]) => ({
      providerId,
      type: stored.type,
    }))
  }

  /** Serialize one read-modify-write against login and token refresh processes. */
  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const document = await this.document()
      const next = await fn(document[providerId])
      if (next === undefined) return document[providerId]
      document[providerId] = next
      await this.write(document)
      return next
    })
  }

  /** Remove one provider credential under the same cross-process lock. */
  async delete(providerId: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await withFileLock(this.path, async () => {
      const document = await this.document()
      if (!(providerId in document)) return
      const { [providerId]: _removed, ...remaining } = document
      await this.write(remaining)
    })
  }
}
