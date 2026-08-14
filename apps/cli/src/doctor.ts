/**
 * Environment and credential diagnostics for the `dsh` CLI.
 *
 * Checks the runtime version, the DeepSeek API key, the harness home's
 * writability, and the optional OpenAI GPT login state, printing one line per
 * check; any failure sets a nonzero exit code.
 * @module @deepseek-ai/dsh/doctor
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PiAiCredentialStore } from '@deepseek-ai/dsh-llm-pi-ai'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** One printed diagnostic line. */
interface DoctorCheck {
  label: string
  ok: boolean
  detail: string
}

async function homeWritable(home: string): Promise<boolean> {
  try {
    await mkdir(home, { recursive: true })
    const probe = join(home, '.doctor-probe')
    await writeFile(probe, '')
    await rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** Print the environment and credential report; exits 1 when any check fails. */
export async function runDoctor(): Promise<void> {
  const [majorRaw, minorRaw] = process.versions.node.split('.')
  const major = Number(majorRaw ?? '0')
  const minor = Number(minorRaw ?? '0')
  const nodeOk = major > 22 || (major === 22 && minor >= 19)

  const apiKey = process.env.DEEPSEEK_API_KEY
  const keyOk = apiKey !== undefined && apiKey.length > 0

  const home = dshHomePath()
  const homeOk = await homeWritable(home)

  const credentials = new PiAiCredentialStore(dshHomePath('pi-ai-auth.json'))
  const credential = await credentials.read('openai-codex')
  const openAiDetail = credential?.type === 'oauth'
    ? 'ChatGPT OAuth'
    : credential?.type === 'api_key'
      ? 'API key'
      : 'not logged in (optional; run dsh login to enable GPT)'

  const checks: readonly DoctorCheck[] = [
    { label: 'node', ok: nodeOk, detail: `v${process.versions.node} (need >= 22.19)` },
    { label: 'DEEPSEEK_API_KEY', ok: keyOk, detail: keyOk ? 'set' : 'missing — export it or put it in .env' },
    { label: 'home', ok: homeOk, detail: `${home}${homeOk ? '' : ' (not writable)'}` },
    { label: 'openai', ok: credential !== undefined, detail: openAiDetail },
  ]

  for (const check of checks) {
    process.stdout.write(`${check.ok ? '✓' : '✗'} ${check.label}: ${check.detail}\n`)
  }
  if (checks.some(check => !check.ok)) process.exitCode = 1
}
