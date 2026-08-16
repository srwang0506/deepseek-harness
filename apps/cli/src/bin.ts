#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const version = readVersion()
// The terminal header reads this to print the same version as `dsh --version`.
process.env.DSH_VERSION = version
const invocation = parseDshArgs(process.argv.slice(2), version)

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  case 'login': {
    if (invocation.method === 'status') {
      const { openAiStatus } = await import('./openai.ts')
      await openAiStatus()
      break
    }
    const { loginOpenAi } = await import('./openai.ts')
    await loginOpenAi(invocation.method)
    break
  }
  case 'model': {
    const { selectModel } = await import('./model.ts')
    await selectModel(invocation.args)
    break
  }
  case 'status': {
    const { openAiStatus } = await import('./openai.ts')
    await openAiStatus()
    break
  }
  case 'logout': {
    const { logoutOpenAi } = await import('./openai.ts')
    await logoutOpenAi()
    break
  }
  case 'doctor': {
    const { runDoctor } = await import('./doctor.ts')
    await runDoctor()
    break
  }
  case 'completion': {
    const { runCompletion } = await import('./completion.ts')
    runCompletion(invocation.shell)
    break
  }
  case 'mcp': {
    const { addMcpServer, getMcpServer, listMcpServers, loginMcpServer, logoutMcpServer, removeMcpServer } = await import('./mcp.ts')
    if (invocation.action === 'list') {
      await listMcpServers()
    } else if (invocation.action === 'add') {
      await addMcpServer(invocation.name, {
        ...(invocation.command === undefined ? {} : { command: invocation.command }),
        ...(invocation.url === undefined ? {} : { url: invocation.url }),
        args: invocation.args,
      })
    } else if (invocation.action === 'get') {
      await getMcpServer(invocation.name)
    } else if (invocation.action === 'login') {
      await loginMcpServer(invocation.name)
    } else if (invocation.action === 'logout') {
      await logoutMcpServer(invocation.name)
    } else {
      await removeMcpServer(invocation.name)
    }
    break
  }
  case 'update': {
    const { runUpdate } = await import('./update.ts')
    runUpdate()
    break
  }
  case 'provider': {
    const { addProvider, listProviders, removeProvider } = await import('./provider.ts')
    if (invocation.action === 'list') {
      await listProviders()
    } else if (invocation.action === 'add') {
      await addProvider(invocation.name, {
        apiKeyEnv: invocation.apiKeyEnv ?? '',
        ...(invocation.baseURL === undefined ? {} : { baseURL: invocation.baseURL }),
        ...(invocation.model === undefined ? {} : { model: invocation.model }),
        ...(invocation.displayName === undefined ? {} : { displayName: invocation.displayName }),
      })
    } else {
      await removeProvider(invocation.name)
    }
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
