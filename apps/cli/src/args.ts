/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
 * and `dsh --profile web -h` prints the web app's help, not this one's.
 *
 * `web` is a hardcoded alias for `--profile web`; `plugin` manages a profile's
 * plugin dependencies by forwarding to pnpm.
 * @module @deepseek-ai/dsh/args
 */

import { Command, CommanderError } from 'commander'

/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/** Log into the optional OpenAI GPT provider. */
interface LoginInvocation {
  mode: 'login'
  /** Named login method; prompted interactively when omitted. */
  method: string | undefined
}

/** Select or show the default agent model. */
interface ModelInvocation {
  mode: 'model'
  /** `[family, modelId?, reasoningEffort?]`; empty shows the current selection. */
  args: string[]
}

/** Print the OpenAI GPT login state. */
interface StatusInvocation {
  mode: 'status'
}

/** Remove the stored OpenAI GPT credential. */
interface LogoutInvocation {
  mode: 'logout'
}

/** Print environment and credential diagnostics. */
interface DoctorInvocation {
  mode: 'doctor'
}

/** Print a shell completion script. */
interface CompletionInvocation {
  mode: 'completion'
  /** `bash` (default) or `zsh`. */
  shell: string | undefined
}

/** Manage MCP servers. */
interface McpInvocation {
  mode: 'mcp'
  /** `list` prints configured servers; `add`/`remove` edit the home patch. */
  action: 'list' | 'add' | 'remove'
  /** Stable server name; empty for `list`. */
  name: string
  /** add options; absent when unused. */
  command?: string
  args: string[]
  url?: string
}

/** Re-run the published installer for the current platform. */
interface UpdateInvocation {
  mode: 'update'
}

/** Manage pi-ai provider routes. */
interface ProviderInvocation {
  mode: 'provider'
  /** `list` prints configured routes; `add`/`remove` edit them. */
  action: 'list' | 'add' | 'remove'
  /** Provider route name; empty for `list`. */
  name: string
  /** add options; absent when unused. */
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  displayName?: string
}

/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation =
  | ProfileInvocation
  | DumpConfigInvocation
  | PluginInvocation
  | LoginInvocation
  | ModelInvocation
  | StatusInvocation
  | LogoutInvocation
  | ProviderInvocation
  | DoctorInvocation
  | CompletionInvocation
  | McpInvocation
  | UpdateInvocation

/** Launcher flags shared by the default command and the `web` alias. */
interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The launcher's own help text; each app prints its own. */
const HELP_EXAMPLES = `
Examples:
  dsh                                         start the interactive terminal client
  dsh exec "run the tests"                    answer one task and exit (one-shot)
  dsh "run the tests"                         alias of: dsh exec "run the tests"
  dsh resume                                  pick a persisted session to continue
  dsh resume --last                           continue the most recent session
  dsh resume <session-id>                     continue the named session
  dsh web                                     boot the web UI (same as: dsh --profile web)
  dsh --profile <name> ...                    boot any named profile
  dsh --profile web --help                    the web app's own flags and help
  dsh plugin --profile tui add <package>      install a plugin into a profile
  dsh login                                   log into the optional OpenAI GPT provider
  dsh model gpt                               select an OpenAI GPT default model
  dsh status                                  show the OpenAI GPT login state
  dsh doctor                                  check environment and credentials
  dsh provider add anthropic --api-key-env ANTHROPIC_API_KEY
  dsh provider add gateway --api-key-env GATEWAY_KEY --base-url https://gateway.example/v1 --model gpt-4o
`

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  const program: Command = new Command()
  program
    .name('dsh')
    .version(version, '-V, --version', 'output the version number')
    .description('dsh: an interactive Codex-style coding terminal client, with a one-shot mode and a web UI.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. `dsh -h` with no profile still prints this help, below.
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile\'s app (see: dsh --profile <name> --help)')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      // With the app owning -h, the launcher's own help is what a bare
      // `dsh -h` (no profile to hand it to) must print.
      if (options.profile === undefined
        && args.some(argument => argument === '-h' || argument === '--help')) {
        program.help()
      }
      // Bare `dsh` (no profile, no web/plugin subcommand) boots the terminal
      // client profile; the tui app owns the task positional and its flags.
      const profile = options.profile ?? 'tui'
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: dsh web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const exec = program.command('exec').description('answer one task and exit; the terminal app\'s own flags follow (--json, --jsonl, --resume, -m, -i, --ephemeral)')
  exec
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[task...]', 'the one-shot task text')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed tui-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the tui profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('exec')
      if (args.length === 0 && options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
        program.error('error: exec needs a task, e.g. dsh exec "run the tests"')
      }
      resolved = resolveBoot(exec, 'tui', options, args)
    })

  const resume = program.command('resume').description('continue a persisted terminal session: pick from a list, resume the most recent (--last), or resume the given id')
  resume
    .argument('[session-id]', 'the session to resume; omitted opens the session picker')
    .option('-l, --last', 'resume the most recent persisted session')
    .action((sessionId: string | undefined, options: { last?: boolean }) => {
      rejectParentOptions('resume')
      if (options.last === true && sessionId !== undefined) {
        program.error('error: resume takes either a session id or --last, not both')
      }
      const args = options.last === true
        ? ['--continue']
        : sessionId !== undefined
          ? ['--resume', sessionId]
          : ['--resume-picker']
      resolved = { mode: 'profile', profile: 'tui', patches: [], args }
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  const login = program.command('login').description('log into the optional OpenAI GPT provider')
  login
    .argument('[method]', 'browser, device, or api-key; prompted when omitted')
    .action((method: string | undefined) => {
      rejectParentOptions('login')
      resolved = { mode: 'login', method }
    })

  const model = program.command('model').description('select or show the default agent model')
  model
    .allowUnknownOption()
    .argument('[args...]', 'deepseek | gpt [model] [effort] | status; empty shows the current model')
    .action((args: string[]) => {
      rejectParentOptions('model')
      resolved = { mode: 'model', args }
    })

  const status = program.command('status').description('show the OpenAI GPT login state')
  status.action(() => {
    rejectParentOptions('status')
    resolved = { mode: 'status' }
  })

  const logout = program.command('logout').description('remove the stored OpenAI GPT credential')
  logout.action(() => {
    rejectParentOptions('logout')
    resolved = { mode: 'logout' }
  })

  const doctor = program.command('doctor').description('check environment, credentials, and the harness home')
  doctor.action(() => {
    rejectParentOptions('doctor')
    resolved = { mode: 'doctor' }
  })

  const completion = program.command('completion').description('print a shell completion script')
  completion
    .argument('[shell]', 'bash (default) or zsh')
    .action((shell: string | undefined) => {
      rejectParentOptions('completion')
      resolved = { mode: 'completion', shell }
    })

  const mcp = program.command('mcp').description('manage MCP servers (stdio or streamable-http)')
  const mcpAdd = mcp.command('add').description('add or replace one MCP server')
  mcpAdd
    .argument('<name>', 'stable server name ([A-Za-z0-9_-]{1,32})')
    .option('--command <cmd>', 'executable for a stdio server')
    .option('--arg <arg>', 'server argument without shell interpretation (repeatable)', collect, [])
    .option('--url <url>', 'streamable-HTTP endpoint URL')
    .action((name: string, options: { command?: string; arg: string[]; url?: string }) => {
      rejectParentOptions('mcp')
      resolved = {
        mode: 'mcp',
        action: 'add',
        name,
        args: options.arg,
        ...(options.command === undefined ? {} : { command: options.command }),
        ...(options.url === undefined ? {} : { url: options.url }),
      }
    })

  mcp
    .command('remove')
    .description('remove a configured MCP server')
    .argument('<name>', 'server name written by a previous `mcp add`')
    .action((name: string) => {
      rejectParentOptions('mcp')
      resolved = { mode: 'mcp', action: 'remove', name, args: [] }
    })

  mcp.command('list').description('list configured MCP servers').action(() => {
    rejectParentOptions('mcp')
    resolved = { mode: 'mcp', action: 'list', name: '', args: [] }
  })

  const update = program.command('update').description('re-run the published installer for the current platform')
  update.action(() => {
    rejectParentOptions('update')
    resolved = { mode: 'update' }
  })

  const provider = program.command('provider').description('manage pi-ai provider routes (third-party models)')
  const providerAdd = provider.command('add').description('configure a catalog route or a custom OpenAI-compatible endpoint')
  providerAdd
    .argument('<name>', 'route id: a pi-ai catalog id (openai, anthropic, gemini, …) or any name for a custom endpoint')
    .requiredOption('--api-key-env <env>', 'environment variable (or credential ref) holding the provider API key')
    .option('--base-url <url>', 'custom OpenAI-compatible endpoint base URL')
    .option('--model <id>', 'model id for a custom endpoint (required with --base-url)')
    .option('--name <display>', 'user-facing route name')
    .action((name: string, options: { apiKeyEnv: string; baseUrl?: string; model?: string; name?: string }) => {
      rejectParentOptions('provider')
      resolved = {
        mode: 'provider',
        action: 'add',
        name,
        apiKeyEnv: options.apiKeyEnv,
        ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.name === undefined ? {} : { displayName: options.name }),
      }
    })

  provider
    .command('remove')
    .description('remove a configured provider route')
    .argument('<name>', 'route id written by a previous `provider add`')
    .action((name: string) => {
      rejectParentOptions('provider')
      resolved = { mode: 'provider', action: 'remove', name }
    })

  const providers = program.command('providers').description('list configured pi-ai provider routes')
  providers.action(() => {
    rejectParentOptions('providers')
    resolved = { mode: 'provider', action: 'list', name: '' }
  })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('dsh: no invocation resolved')
  return resolved
}
