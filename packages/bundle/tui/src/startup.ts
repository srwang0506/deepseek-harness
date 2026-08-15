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
  /** Image files attached to the first user message. */
  images: string[]
  /** Delete the persisted session after a one-shot run. */
  ephemeral: boolean
  /** Open the session picker instead of adopting a session at startup. */
  resumePicker: boolean
  /** Read the one-shot task from piped stdin instead of the positional. */
  stdinTask: boolean
  /** JSON Schema (inline JSON or a file path) the final output must match. */
  outputSchema: string
  /** Write the final output to this file instead of stdout. */
  outputFile: string
}

/** The flag family as commander parsed it. */
interface TuiOptions {
  resume?: string
  continue?: boolean
  model?: string
  json?: boolean
  jsonl?: boolean
  image?: string[]
  ephemeral?: boolean
  resumePicker?: boolean
  stdinTask?: boolean
  outputSchema?: string
  outputFile?: string
}

/** Repeatable single-value collector: `--image a.png --image b.png`. */
const collectImages = (value: string, previous: string[] = []): string[] => [...previous, value]

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
    .option('-i, --image <path>', 'attach an image file (png/jpeg/webp/gif; repeatable)', collectImages, [])
    .option('--ephemeral', 'one-shot: delete the persisted session after the run')
    .option('--resume-picker', 'open the session picker on startup (dsh resume)')
    .option('--stdin-task', 'read the one-shot task from piped stdin')
    .option('--output-schema <schema>', 'JSON Schema (inline JSON or a file path) the one-shot output must match')
    .option('-o, --output-file <path>', 'write the one-shot output to this file instead of stdout')
    .addHelpText('after', `
Examples:
  dsh                              start an interactive session
  dsh exec "run the tests"         answer one task and exit (one-shot)
  dsh "run the tests"              alias of: dsh exec "run the tests"
  dsh exec --json "run the tests"  one task, JSON result on stdout
  dsh exec --jsonl "run the tests" one task, streamed JSONL events
  dsh exec -i shot.png "fix this UI"  one task with an attached image
  cat prompt.txt | dsh exec          one task read from piped stdin
  dsh exec -o out.json "answer"      one task, output written to out.json
  dsh exec --output-schema '{"type":"string"}' "answer"   validate the final output
  dsh --resume <session-id>        resume an earlier session interactively
  dsh --continue                   resume the most recent session
  dsh resume                       pick a session to resume from a list
  dsh resume --last                resume the most recent session
  dsh -m deepseek-chat "hi"        one task with a specific model

Interactive commands:
  /new                             start a fresh session
  /resume [id]                     list sessions, or resume the given id
  /model [model]                   show the model, or switch it
  /status                          show session state: model, sandbox, approval, usage
  /permissions                     show the permission presets, or switch
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
  Ctrl+D                           quit and flush
  Esc                              toggle Vim normal mode (h/l, 0/$, w/b, x, D, i/a/I/A)
  Ctrl+U                           clear the composer line
  Ctrl+R                           search the submitted prompt history
  @                                fuzzy search project files (Enter inserts the mention)
  Tab (while running)              queue the line for the next turn

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
    if (options.stdinTask === true && program.args.length > 0) {
      program.error('error: --stdin-task takes the task from stdin and no positional')
    }
    if (options.outputSchema !== undefined && options.outputSchema.trim() === '') {
      program.error('error: --output-schema needs inline JSON or a file path')
    }
    if (options.json === true && options.jsonl === true) {
      program.error('error: --json and --jsonl are mutually exclusive')
    }
    ctx.provide(TUI_STARTUP_SERVICE, {
      task: program.args.join(' '),
      resumeSessionId: options.resume ?? '',
      continue: options.continue === true,
      resumePicker: options.resumePicker === true,
      model: options.model ?? '',
      output: options.jsonl === true ? 'jsonl' : options.json === true ? 'json' : 'text',
      images: options.image ?? [],
      ephemeral: options.ephemeral === true,
      stdinTask: options.stdinTask === true,
      outputSchema: options.outputSchema ?? '',
      outputFile: options.outputFile ?? '',
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
