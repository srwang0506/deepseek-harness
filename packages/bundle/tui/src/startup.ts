/**
 * The terminal app's command-line provider: it parses the one-shot task
 * positional and this app's flags (`--resume`, `--continue`, `--model`) and
 * its `--help`, then publishes {@link TUI_STARTUP_SERVICE}. The runner is an
 * ordinary consumer whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the invocation can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the terminal runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** The one-shot task text; empty string means interactive mode. */
  task: string
  /** The resume session id; empty string means a fresh session. */
  resumeSessionId: string
  /** Resume the most recent session. */
  continue: boolean
  /** The `--model` override; empty string means the configured default. */
  model: string
  /** One-shot output format: plain text, a final JSON object, or streaming JSONL. */
  output: 'text' | 'json' | 'jsonl'
}

/** The flag family as commander parsed it. */
interface TuiOptions {
  resume?: string
  continue?: boolean
  model?: string
  json?: boolean
  jsonl?: boolean
}

/**
 * This app's command: the task positional, its flags, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh')
    .description('Interactive terminal client: a coding agent in your terminal.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the one-shot task text; omit to enter interactive mode')
    .option('--resume <session-id>', 'resume the persisted session with this id')
    .option('-c, --continue', 'resume the most recent session')
    .option('-m, --model <model>', 'the model id (or provider/id) to use')
    .option('--json', 'one-shot: print one JSON result object on stdout')
    .option('--jsonl', 'one-shot: stream session events as JSON lines')
    .addHelpText('after', `
Examples:
  dsh                              start an interactive session
  dsh "run the tests"              answer one task and exit
  dsh --json "run the tests"       one task, JSON result on stdout
  dsh --jsonl "run the tests"      one task, streamed JSONL events
  dsh --resume <session-id>        resume an earlier session interactively
  dsh --continue                   resume the most recent session
  dsh -m deepseek-chat "hi"        one task with a specific model

Interactive commands:
  /new                             start a fresh session
  /resume [id]                     list sessions, or resume the given id
  /model [model]                   show the model, or switch it
  /status                          show model, session, and cwd
  /compact                         compact the session history
  /init                            write an AGENTS.md template
  /doctor                          check environment and credentials
  /export [file]                   export the session log as JSONL
  /diff                            show this session's file changes
  /undo                            revert the most recent file change
  /help                            show this help
  /quit                            exit

Keys:
  Shift+Tab                        cycle the permission preset
  Ctrl+P                           toggle plan mode
  Ctrl+C                           cancel the running turn

Custom commands: $DSH_HOME/commands/<name>.md (prompt template, $ARGUMENTS placeholder).
`)
}

/**
 * Parse and provide the terminal invocation as an ordinary Cordis service. The
 * command's action publishes the parsed values; a rejected combination is a
 * usage error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<TuiOptions>()
    if (options.resume !== undefined && options.resume.trim() === '') {
      program.error('error: --resume needs a session id')
    }
    if (options.resume !== undefined && options.continue === true) {
      program.error('error: --resume and --continue are mutually exclusive')
    }
    if (options.json === true && options.jsonl === true) {
      program.error('error: --json and --jsonl are mutually exclusive')
    }
    ctx.provide(TUI_STARTUP_SERVICE, {
      task: program.args.join(' '),
      resumeSessionId: options.resume ?? '',
      continue: options.continue === true,
      model: options.model ?? '',
      output: options.jsonl === true ? 'jsonl' : options.json === true ? 'json' : 'text',
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
