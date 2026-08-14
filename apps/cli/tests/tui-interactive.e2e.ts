import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Drive a bare `dsh` REPL in a PTY: prompt, stream, then `/quit`. */
const POSIX_TUI_PTY_DRIVER = String.raw`
import errno, json, os, pty, select, signal, sys, time
node, launch_args_json, launch_env_json, cwd, timeout_seconds = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(launch_env_json))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(launch_args_json)], env)

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

def wait_for(marker):
    while marker not in output:
        if time.monotonic() >= deadline:
            return False
        pump()
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return marker in output
    return True

def wait_exit():
    while True:
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return candidate
        if time.monotonic() >= deadline:
            return None
        pump()

banner_ok = wait_for(b"/help")
if banner_ok:
    os.write(fd, b"hello\n")
response_ok = banner_ok and wait_for(b"mock interactive response")
if response_ok:
    os.write(fd, b"/quit\n")
status = wait_exit()

sys.stdout.buffer.write(output)
if not banner_ok:
    sys.stderr.write("no banner before timeout\n")
    sys.exit(124)
if not response_ok:
    sys.stderr.write("no streamed response before timeout\n")
    sys.exit(124)
if status is None:
    os.kill(pid, signal.SIGKILL)
    sys.stderr.write("did not exit after /quit\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != 0:
    sys.stderr.write(f"expected exit 0, got {actual_exit}\n")
    sys.exit(125)
`

async function runTuiPty(env: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-interactive-'))
  const launch = resolveExampleLaunch({
    srcBin: dshBinScript,
    configArgs: [],
    tsconfigPath,
    env,
  })
  try {
    const timeoutMs = 30_000
    const result = await execa('python3', [
      '-c',
      POSIX_TUI_PTY_DRIVER,
      launch.command,
      JSON.stringify(launch.args),
      JSON.stringify(launch.env),
      cwd,
      String(timeoutMs / 1_000),
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
      })
      expect(output).toContain('dsh')
      expect(output).toContain('/help')
      expect(output).toContain('mock interactive response')
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
