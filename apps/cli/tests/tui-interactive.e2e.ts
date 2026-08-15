import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One driver step: wait for output, sleep, send text/control bytes, or expect an exit code. */
type PtyStep =
  | { op: 'wait'; text: string; occurrences?: number }
  | { op: 'sleep'; seconds: number }
  | { op: 'send'; text: string }
  | { op: 'raw'; text: string }
  | { op: 'ctrl'; char: string }
  | { op: 'arrow'; dir: 'up' | 'down' }
  | { op: 'expect-exit'; code: number }

/**
 * Drive a bare `dsh` REPL in a PTY through a step list, printing the whole
 * transcript on every failure. The last step is usually `expect-exit`, which
 * also asserts the process's final exit code.
 */
const POSIX_TUI_PTY_DRIVER = String.raw`
import errno, fcntl, json, os, pty, select, signal, struct, sys, termios, time
node, launch_args_json, launch_env_json, cwd, timeout_seconds, steps_json = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(launch_env_json))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(launch_args_json)], env)
# Pin a real terminal size: a fresh pty inherits no winsize and a 0-row
# surface makes the Ink layout render nothing.
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 120, 0, 0))

output = bytearray()
deadline = time.monotonic() + float(timeout_seconds)

def pump():
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)

def wait_for(marker, occurrences):
    marker = marker.encode("utf-8")
    while output.count(marker) < occurrences:
        if time.monotonic() >= deadline:
            return False
        pump()
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return output.count(marker) >= occurrences
    return True

def wait_exit():
    while True:
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return candidate
        if time.monotonic() >= deadline:
            return None
        pump()

exit_code = 0
for step in json.loads(steps_json):
    op = step["op"]
    if op == "wait":
        if not wait_for(step["text"], int(step.get("occurrences", 1))):
            sys.stdout.buffer.write(output)
            sys.stderr.write("timed out waiting for %r\n" % step["text"])
            os.kill(pid, signal.SIGKILL)
            sys.exit(124)
    elif op == "sleep":
        time.sleep(step["seconds"])
        pump()
    elif op == "send":
        # One character per write, waiting for each key's rendered echo
        # before the next: the harness child can stall for seconds under
        # load, and keys written blindly coalesce into one chunk that Ink's
        # parseKeypress consumes as a single keypress (the trailing Enter
        # would be lost). The echo is a re-rendered frame, i.e. output growth.
        text = step["text"]
        keys = [*text]
        for index, char in enumerate(keys):
            payload = "\r" if char == "\n" else char
            if char == "\n":
                # Settle after the previous key's rendered frame before the
                # CR: under load the child's read can lag the render, and a
                # CR landing before the prior chunk is read coalesces with it
                # and is dropped by Ink's single-keypress parser.
                settle_deadline = time.monotonic() + 1.0
                while time.monotonic() < settle_deadline:
                    pump()
            before = len(output)
            os.write(fd, payload.encode("utf-8"))
            echo_deadline = time.monotonic() + 10
            while len(output) <= before and time.monotonic() < echo_deadline:
                pump()
                waited, candidate = os.waitpid(pid, os.WNOHANG)
                if waited == pid:
                    break
            # A settled render replaces the input line; the CR's own echo is
            # the cleared prompt, which also grows the buffer.
            settle = 0.1 if char != "\n" else 0.4
            settle_deadline = time.monotonic() + settle
            while time.monotonic() < settle_deadline:
                pump()
    elif op == "raw":
        # A bare write without echo-wait: for keys whose rendered effect is
        # invisible (Vim motions), where the echo-wait would stall.
        os.write(fd, step["text"].encode("utf-8"))
    elif op == "ctrl":
        # The control byte for Ctrl+<char>, e.g. 'c' -> 0x03, 'd' -> 0x04.
        os.write(fd, bytes([ord(step["char"]) & 0x1F]))
    elif op == "arrow":
        # Echo-wait like a typed key: an Enter written before the child reads
        # the escape sequence would coalesce into one chunk that Ink parses
        # as a single arrow keypress, dropping the trailing CR.
        before = len(output)
        os.write(fd, b"\x1b[A" if step["dir"] == "up" else b"\x1b[B")
        echo_deadline = time.monotonic() + 10
        while len(output) <= before and time.monotonic() < echo_deadline:
            pump()
            waited, candidate = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                break
    elif op == "expect-exit":
        exit_code = step["code"]
        break
    else:
        sys.stderr.write("unknown step %s\n" % op)
        os.kill(pid, signal.SIGKILL)
        sys.exit(126)

status = wait_exit()
sys.stdout.buffer.write(output)
if status is None:
    os.kill(pid, signal.SIGKILL)
    sys.stderr.write("process did not exit after the final step\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != exit_code:
    sys.stderr.write("expected exit %d, got %d\n" % (exit_code, actual_exit))
    sys.exit(125)
`

async function runTuiPty(env: Record<string, string>, steps: readonly PtyStep[], extraArgs: readonly string[] = []): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-interactive-'))
  const launch = resolveExampleLaunch({
    srcBin: dshBinScript,
    configArgs: [],
    tsconfigPath,
    env,
  })
  try {
    const timeoutMs = 80_000
    const result = await execa('python3', [
      '-c',
      POSIX_TUI_PTY_DRIVER,
      launch.command,
      JSON.stringify([...launch.args, ...extraArgs]),
      JSON.stringify(launch.env),
      cwd,
      String(timeoutMs / 1_000),
      JSON.stringify(steps),
    ], {
      stdin: 'ignore',
      timeout: timeoutMs + 5_000,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    if (result.timedOut) {
      throw new Error(`dsh tui PTY driver timed out. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    if (result.failed) {
      throw new Error(`dsh tui PTY driver exited ${String(result.exitCode)}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    return result.stdout
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/**
 * Run `dsh exec` outside a PTY: one task, optional extra flags, optional
 * piped stdin. Returns the process outcome instead of throwing.
 */
async function runDshExec(
  env: Record<string, string>,
  task: string | undefined,
  extraArgs: readonly string[] = [],
  input?: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-seed-'))
  const launch = resolveExampleLaunch({
    srcBin: dshBinScript,
    configArgs: [],
    tsconfigPath,
    env,
  })
  try {
    const args = [...launch.args, 'exec', ...(task === undefined ? [] : [task]), ...extraArgs]
    const result = await execa(launch.command, args, {
      cwd,
      env: launch.env,
      timeout: 60_000,
      reject: false,
      stripFinalNewline: false,
      ...(input === undefined ? {} : { input }),
    })
    return { exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/** Seed one persisted session through `dsh exec` against the shared home. */
async function runDshOneShot(env: Record<string, string>, task: string): Promise<void> {
  const result = await runDshExec(env, task)
  if (result.exitCode !== 0) {
    throw new Error(`dsh exec seed failed (exit ${String(result.exitCode)}): ${result.stderr}`)
  }
}

/**
 * Every persisted session's decoded log under a DSH_HOME, concatenated,
 * read through the official jsonl backend's `readRaw` seam.
 */
async function persistedSessions(dshHome: string): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(dshHome, 'sessions') })
  const persistence = ctx.sessionPersistence
  const collected: string[] = []
  for (const header of await persistence.list()) {
    const raw = await persistence.readRaw(SessionId(header.id))
    if (raw !== undefined) collected.push(raw.content)
  }
  await ctx.fiber.dispose()
  return collected.join('\n')
}

describe.skipIf(process.platform === 'win32')('tui interactive REPL (real Loader tree in a PTY)', () => {
  it('streams a response and quits with /quit', async () => {
    const apiKey = 'tui-interactive-key'
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh'),
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'hello\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('dsh')
      expect(output).toContain('sandbox workspace-write')
      expect(output).toContain('mock interactive response')
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('shows /status, switches the permission preset, and persists the policy', async () => {
    const apiKey = 'tui-status-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'wait', text: 'sandbox workspace-write' },
        { op: 'send', text: '/status\n' },
        { op: 'wait', text: 'approval ask' },
        { op: 'wait', text: 'permissions workspace-write (available: read-only, workspace-write, danger-full-access)' },
        { op: 'send', text: '/permissions\n' },
        { op: 'wait', text: 'one-time: answer a prompt (y/n)' },
        { op: 'send', text: '/permissions read-only\n' },
        { op: 'wait', text: 'permission preset set to read-only' },
        { op: 'wait', text: 'sandbox read-only' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ], ['-m', 'deepseek-chat'])
      expect(output).toContain('session ')
      expect(output).toContain('model deepseek-official/deepseek-chat')
      expect(output).toContain('cwd ')
      expect(output).toContain('permissions — session policy')
      // The launch override is marked in the status bar and the /status view.
      expect(output).toContain('model override: deepseek-official/deepseek-chat (from -m; this launch only)')
      expect(output).toContain('-m')
      // The switch is durable: the knob events persist with the session.
      const persisted = await persistedSessions(home)
      expect(persisted).toContain('sandbox/mode')
      expect(persisted).toContain('permission/preset')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('edits the composer with Vim motions before submitting', async () => {
    const apiKey = 'tui-vim-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'abcd' },
        { op: 'wait', text: 'abcd' },
        // Esc to normal mode, h left, x deletes 'd', Esc back to insert.
        { op: 'raw', text: '\x1b' },
        { op: 'sleep', seconds: 0.3 },
        { op: 'raw', text: 'h' },
        { op: 'sleep', seconds: 0.3 },
        { op: 'raw', text: 'x' },
        { op: 'sleep', seconds: 0.3 },
        { op: 'raw', text: '\x1b' },
        { op: 'sleep', seconds: 0.3 },
        { op: 'send', text: 'e' },
        { op: 'wait', text: 'abce' },
        { op: 'send', text: '\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      // The edited line is what reaches the model: abcd - d + e at the cursor.
      expect(server.requests.some(r => JSON.stringify(r.body).includes('abce'))).toBe(true)
      expect(output).toContain('abce')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('searches the submitted prompt history with Ctrl+R and reuses a line', async () => {
    const apiKey = 'tui-history-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'first message\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: 'second message\n' },
        { op: 'wait', text: 'mock interactive response', occurrences: 2 },
        { op: 'ctrl', char: 'r' },
        { op: 'wait', text: 'history search: ' },
        { op: 'send', text: 'first' },
        // Conversation echo + the overlay row: two occurrences so far.
        { op: 'wait', text: 'first message', occurrences: 2 },
        { op: 'send', text: '\n' },
        // The reused line lands in the composer: one more occurrence.
        { op: 'wait', text: 'first message', occurrences: 3 },
        { op: 'send', text: '\n' },
        { op: 'wait', text: 'mock interactive response', occurrences: 3 },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('history search: first')
      // The reused line is the third request body.
      expect(server.requests.length).toBeGreaterThanOrEqual(3)
      expect(JSON.stringify(server.requests[2]?.body)).toContain('first message')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('searches project files with @ and inserts the mention', async () => {
    const apiKey = 'tui-files-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        // Seed a project file in the PTY's own cwd: the @ index builds on
        // first use, so these files must exist before the first @.
        { op: 'send', text: '!mkdir -p src\n' },
        { op: 'wait', text: 'exit 0' },
        { op: 'send', text: '!echo marker-abc > src/hello.ts\n' },
        { op: 'wait', text: 'exit 0', occurrences: 2 },
        { op: 'send', text: '@' },
        { op: 'wait', text: 'file search: ' },
        { op: 'send', text: 'hello' },
        { op: 'wait', text: 'src/hello.ts' },
        { op: 'send', text: '\n' },
        { op: 'wait', text: '@src/hello.ts' },
        { op: 'send', text: '\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('file search: hello')
      // The mentioned file's content reaches the model as injected context.
      expect(server.requests.some(r => JSON.stringify(r.body).includes('marker-abc'))).toBe(true)
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  // The Tab-queue path has no PTY scenario on purpose: the driver's typed
  // keys coalesce into one read chunk with the tab embedded (Ink parses it
  // as plain text), the mock's 8-char SSE chunks make any stream either too
  // short or too slow to race against the echo-wait protocol, and the queue
  // semantics (queue-while-running, drain, replace, dispose-clear, and the
  // Tab-while-running App branch with its ⇥ queued status marker) are fully
  // covered by controller.spec.ts and ui-render.spec.ts instead.
  it('edits a previous message and forks the session from it', async () => {
    const apiKey = 'tui-editfork-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'first message\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: 'second message\n' },
        { op: 'wait', text: 'mock interactive response', occurrences: 2 },
        { op: 'arrow', dir: 'up' },
        { op: 'wait', text: 'edit message' },
        { op: 'wait', text: '› second message' },
        { op: 'send', text: '\n' },
        // The conversation echo plus the composer holding the loaded message.
        { op: 'wait', text: 'second message', occurrences: 2 },
        { op: 'send', text: ' edited\n' },
        { op: 'wait', text: 'mock interactive response', occurrences: 3 },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('edit message')
      // The session-title plugin adds one non-agent request after the first
      // turn; the fork's own turn is the third AGENT request.
      const agentRequests = server.requests.filter(r => JSON.stringify(r.body).includes('You are an AI agent'))
      expect(agentRequests.length).toBe(3)
      expect(JSON.stringify(agentRequests[2]?.body)).toContain('second message edited')
      // The fork is durable: a child session with a parent link persists.
      const persisted = await persistedSessions(home)
      expect(persisted).toContain('second message edited')
      expect(persisted).toContain('parentSession')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('pastes a multi-line prompt and submits it as one message', async () => {
    const apiKey = 'tui-paste-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        // One raw chunk = one paste event: the composer inserts both lines.
        { op: 'raw', text: 'first line\nsecond line' },
        { op: 'sleep', seconds: 0.5 },
        // A follow-up key repaints the frame (the first post-paste paint can
        // be partial) and proves the composer stays editable after the paste.
        { op: 'send', text: ' ' },
        { op: 'wait', text: 'first line' },
        { op: 'wait', text: 'second line' },
        { op: 'send', text: '\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      // Both lines land in the SAME user message.
      const body = JSON.stringify(server.requests.some((r) => {
        const text = JSON.stringify(r.body)
        return text.includes('first line') && text.includes('second line')
      }))
      expect(body).toBe('true')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('runs multiple turns, echoes Chinese input, and flushes sessions on Ctrl+D', async () => {
    const apiKey = 'tui-multiturn-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: '你好，请记住这句话\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: 'second message\n' },
        { op: 'wait', text: 'mock interactive response', occurrences: 2 },
        { op: 'ctrl', char: 'd' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('你好，请记住这句话')
      expect(server.requests.length).toBeGreaterThanOrEqual(2)
      expect(server.requests.some(r => JSON.stringify(r.body).includes('你好，请记住这句话'))).toBe(true)
      expect(server.requests.some(r => JSON.stringify(r.body).includes('second message'))).toBe(true)
      // Ctrl+D must flush: both user messages are durably persisted.
      const persisted = await persistedSessions(home)
      expect(persisted).toContain('你好，请记住这句话')
      expect(persisted).toContain('second message')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('answers a preset question with typed custom text', async () => {
    const apiKey = 'tui-question-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
      toolName: 'ask_user_question',
      toolArguments: JSON.stringify({
        questions: [{
          id: 'color',
          question: 'Which color do you want?',
          options: [{ label: 'red' }, { label: 'blue' }],
        }],
      }),
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'pick a color\n' },
        { op: 'wait', text: '1. red' },
        { op: 'send', text: 'sunset orange\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('sunset orange')
      // The typed custom answer reaches the model as the tool result.
      expect(server.requests.some(r => JSON.stringify(r.body).includes('sunset orange'))).toBe(true)
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('allows an approval with y', async () => {
    const apiKey = 'tui-approval-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
      toolName: 'bash',
      // The sandbox-escalation retry is the terminal's approval prompt: the
      // requested mode strictly widens workspace-write, so the call pauses
      // on the approval seam before anything executes.
      toolArguments: JSON.stringify({
        command: 'echo approval-granted',
        description: 'print the approval grant marker',
        sandbox_permissions: 'danger-full-access',
        justification: 'the interactive test asks for one approval',
      }),
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'run a shell command\n' },
        { op: 'wait', text: 'Run bash' },
        { op: 'send', text: 'y' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('approval-granted')
      expect(server.requests.length).toBeGreaterThanOrEqual(2)
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('dsh resume --last replays the most recent persisted transcript', async () => {
    const apiKey = 'tui-resume-last-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    const env = {
      DSH_HOME: home,
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_BASE_URL: server.baseURL,
      DSH_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    }
    try {
      await runDshOneShot(env, 'seed the resume-last session')
      const output = await runTuiPty(env, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'wait', text: '› seed the resume-last session' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ], ['resume', '--last'])
      expect(output).toContain('› seed the resume-last session')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('dsh resume opens the session picker and resumes the selected session', async () => {
    const apiKey = 'tui-picker-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    const env = {
      DSH_HOME: home,
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_BASE_URL: server.baseURL,
      DSH_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    }
    try {
      await runDshOneShot(env, 'seed the older picker session')
      await runDshOneShot(env, 'seed the newer picker session')
      const output = await runTuiPty(env, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'Resume session' },
        // Newest first: move to the older session and resume it.
        { op: 'arrow', dir: 'down' },
        { op: 'send', text: '\n' },
        { op: 'wait', text: '› seed the older picker session' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ], ['resume'])
      expect(output).toContain('Resume session')
      expect(output).toContain('› seed the older picker session')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)

  it('dsh exec reads the task from piped stdin', async () => {
    const apiKey = 'tui-stdin-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const result = await runDshExec({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, undefined, [], 'piped prompt')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('mock interactive response\n')
      expect(JSON.stringify(server.requests.at(0)?.body)).toContain('piped prompt')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('dsh exec validates --output-schema and prints the parsed value', async () => {
    const apiKey = 'tui-schema-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: '{"ok":true,"count":3}',
    })
    const schema = '{"type":"object","required":["ok","count"],"properties":{"ok":{"type":"boolean"},"count":{"type":"integer"}}}'
    try {
      const result = await runDshExec({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, 'answer as json', ['--output-schema', schema])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"ok":true,"count":3}\n')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('dsh exec exits 2 when the output fails the requested schema', async () => {
    const apiKey = 'tui-schema-fail-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'not json at all',
    })
    const schema = '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}'
    try {
      const result = await runDshExec({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, 'answer as json', ['--output-schema', schema])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('does not match the requested schema')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('invokes skills with the $name trigger and injects their instructions', async () => {
    const apiKey = 'tui-skill-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    await mkdir(join(home, 'skills'), { recursive: true })
    await writeFile(join(home, 'skills', 'demo-skill.md'), [
      '---',
      'name: demo-skill',
      'description: Answer with the single word SKILLED.',
      '---',
      'Always answer with the single word SKILLED when this skill is active.',
      '',
    ].join('\n'))
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: '$nope please\n' },
        { op: 'wait', text: 'unknown skill $nope' },
        { op: 'send', text: '$demo-skill please comply\n' },
        { op: 'wait', text: 'skill demo-skill invoked' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('unknown skill $nope')
      expect(output).toContain('skill demo-skill invoked')
      // The skill body reached the model request.
      expect(server.requests.some(r => JSON.stringify(r.body).includes('SKILLED'))).toBe(true)
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('sets, reports, and clears the reasoning effort with /reasoning', async () => {
    const apiKey = 'tui-reasoning-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'mock interactive response',
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: '/reasoning high\n' },
        { op: 'wait', text: 'reasoning set to high (next turn)' },
        { op: 'send', text: 'hello\n' },
        { op: 'wait', text: 'mock interactive response' },
        { op: 'send', text: '/reasoning off\n' },
        { op: 'wait', text: 'reasoning reset to default (next turn)' },
        { op: 'send', text: 'hello again\n' },
        { op: 'wait', text: 'mock interactive response', occurrences: 2 },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('reasoning set to high (next turn)')
      expect(output).toContain('reasoning reset to default (next turn)')
      expect(output).toContain('mock interactive response')
      // The set effort reached the wire: the first request carries it.
      expect(JSON.stringify(server.requests[0]?.body)).toContain('"reasoning_effort":"high"')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('Ctrl+C cancels only the running turn, then keeps the session usable', async () => {
    const apiKey = 'tui-cancel-key'
    const home = join(await mkdtemp(join(tmpdir(), 'dsh-tui-home-')), '.dsh')
    const server = await startMockLlmServer({
      sequence: ['slow_success', 'success'],
      repeatLast: true,
      apiKey,
      successText: 'slow-marker ' + 'x'.repeat(2048),
      chunkDelayMs: 80,
    })
    try {
      const output = await runTuiPty({
        DSH_HOME: home,
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      }, [
        { op: 'wait', text: 'dsh' },
        { op: 'wait', text: 'deepseek-official' },
        { op: 'send', text: 'start a slow turn\n' },
        { op: 'wait', text: 'slow-marker' },
        { op: 'ctrl', char: 'c' },
        { op: 'wait', text: '(interrupted)' },
        { op: 'send', text: 'after interrupt\n' },
        { op: 'wait', text: 'slow-marker', occurrences: 2 },
        { op: 'send', text: '/quit\n' },
        { op: 'expect-exit', code: 0 },
      ])
      expect(output).toContain('slow-marker')
      expect(output).toContain('(interrupted)')
      expect(server.requests.length).toBeGreaterThanOrEqual(2)
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
