/**
 * OpenAI GPT credential commands for the `dsh` CLI.
 *
 * Thin wrappers over the shared `dsh-llm-pi-ai` login flows that pin the
 * credential document to `$DSH_HOME/pi-ai-auth.json`, the same path the
 * `llm-pi-ai` provider route reads for requests.
 * @module @deepseek-ai/dsh/openai
 */

import { loginOpenAi as sharedLogin, logoutOpenAi as sharedLogout, openAiStatus as sharedStatus } from '@deepseek-ai/dsh-llm-pi-ai'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/**
 * Store or refresh the optional OpenAI GPT credential.
 * @param method - named login method; when omitted and stdin is a terminal, the user is prompted to choose.
 */
export async function loginOpenAi(method: string | undefined): Promise<void> {
  await sharedLogin(dshHomePath('pi-ai-auth.json'), method)
}

/** Print the current OpenAI GPT login state. */
export async function openAiStatus(): Promise<void> {
  await sharedStatus(dshHomePath('pi-ai-auth.json'))
}

/** Remove the stored OpenAI GPT credential. */
export async function logoutOpenAi(): Promise<void> {
  await sharedLogout(dshHomePath('pi-ai-auth.json'))
}
