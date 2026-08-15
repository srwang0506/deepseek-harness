/**
 * The terminal session controller: one long-lived Agent handle shared by the
 * interactive TUI and the one-shot runner. It owns agent adoption and
 * disposal, turn submission with steering, cancellation, the live event
 * stream, and the approval/question answerers, so both surfaces get identical
 * session semantics without driving the core registries directly.
 * @module @deepseek-ai/dsh-tui/controller
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionStore, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionItem, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'

/** UI-agnostic hooks the controller calls instead of touching a surface. */
export interface TerminalSessionCallbacks {
  /** One committed event of the live root or one of its subagents. */
  onEvent: (session: Session, event: SessionEvent) => void
  /** Ask the human to allow or reject one approval; must fail closed. */
  askApproval: (toolName: string, reason: string | undefined) => Promise<ApprovalOutcome>
  /** Ask the human one batch of questions. */
  askQuestions: (questions: readonly AskUserQuestionItem[]) => Promise<AskUserQuestionAnswer>
  /** Fired when the agent's observable running state changes. */
  onRunningChange?: (running: boolean) => void
  /** Fired when the queued next-turn message is set or drained. */
  onQueueChange?: (queued: boolean) => void
  /** Fired after adoption; `resumed` marks a persisted session whose transcript should replay. */
  onAdopt?: (agent: Agent, resumed: boolean) => void
}

/** Constructor options for {@link TerminalSessionController}. */
export interface TerminalSessionControllerOptions {
  /** Plugin context carrying the agents/sessions registries and interaction services. */
  ctx: Context
  /** Mutable model selection the agent reads at each step's prompt assembly. */
  selectionRef: ModelSelectionRef
  /** The surface callbacks. */
  callbacks: TerminalSessionCallbacks
}

/**
 * Whether a session belongs to the live root: itself, or any subagent whose
 * parent chain reaches the root id.
 * @param session - the session to test.
 * @param rootId - the live root session id.
 * @param sessions - the sessions registry used to walk the parent chain.
 */
function belongsToCurrent(session: Session, rootId: string, sessions: SessionStore): boolean {
  let cursor: Session | undefined = session
  while (cursor !== undefined) {
    if (cursor.id === rootId) return true
    const parent = cursor.header.parentSession
    if (parent === undefined) return false
    cursor = sessions.get(parent)
  }
  return false
}

/**
 * The terminal session controller. Construct once per surface, then drive it
 * with {@link start}/{@link submit}/{@link cancel}/{@link shutdown}. Submitting
 * while a turn runs routes the message as steering; submitting while idle
 * opens an ordinary follow-up turn. `shutdown` cancels a running turn, waits
 * for quiescence, flushes the session, disposes the agent, and detaches every
 * listener, in that order.
 */
export class TerminalSessionController {
  private readonly ctx: Context
  private readonly sessions: SessionStore
  private readonly selectionRef: ModelSelectionRef
  private readonly callbacks: TerminalSessionCallbacks
  private readonly disposers: Array<() => void> = []
  private handle: AgentHandle | undefined
  private agent: Agent | undefined
  private running = false
  private queued: UserMessage | undefined
  private listenersDetached = false

  /** @param options - plugin context, model selection, and surface callbacks. */
  constructor(options: TerminalSessionControllerOptions) {
    this.ctx = options.ctx
    this.selectionRef = options.selectionRef
    this.callbacks = options.callbacks
    const sessions = options.ctx.get('sessions')
    if (sessions === undefined) throw new Error('tui-runner: the sessions registry is not mounted')
    this.sessions = sessions
    this.disposers.push(options.ctx.on('session/event', (session, event) => {
      const agent = this.agent
      if (agent === undefined) return
      if (session !== agent.session && !belongsToCurrent(session, agent.id, this.sessions)) return
      options.callbacks.onEvent(session, event)
    }))
    if (options.ctx.get('approval') !== undefined) {
      this.disposers.push(options.ctx.on('approval/request', (req, next) => {
        if (req.agent !== this.agent) return next()
        if (req.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
        return options.callbacks.askApproval(req.toolName, req.reason)
      }))
    }
    const questions = options.ctx.get('userQuestions')
    if (questions !== undefined) {
      const provider: UserQuestionProvider = {
        ask: (request) => {
          if (request.agent !== this.agent) {
            return Promise.reject(new Error('terminal user interaction requires the live terminal agent'))
          }
          return options.callbacks.askQuestions(request.questions)
        },
      }
      this.disposers.push(questions.registerProvider(provider))
    }
  }

  /**
   * The live agent, or undefined before adoption and after disposal.
   * @returns the adopted agent handle, or undefined when none is adopted.
   */
  live(): Agent | undefined {
    return this.agent
  }

  /**
   * Whether the live agent currently has a driver active.
   * @returns true while the live agent reports `running`.
   */
  isRunning(): boolean {
    return this.agent?.status === 'running'
  }

  /**
   * Create or resume the live agent and start answering approvals and
   * questions for it. The surface's `onAdopt` hook fires before this returns.
   * @param resumeSessionId - persisted session id to resume; empty starts fresh.
   * @returns the adopted agent.
   */
  async start(resumeSessionId: string): Promise<Agent> {
    const handle = await this.createAgent(resumeSessionId)
    this.handle = handle
    this.agent = handle.agent
    await handle.agent.whenIdle()
    this.callbacks.onAdopt?.(handle.agent, resumeSessionId !== '')
    return handle.agent
  }

  /**
   * Dispose the live agent and adopt a different session (`/new`, `/fork`,
   * `/resume`).
   * @param resumeSessionId - the next session id to adopt; empty starts fresh.
   * @returns the newly adopted agent.
   */
  async replace(resumeSessionId: string): Promise<Agent> {
    await this.disposeAgent()
    return this.start(resumeSessionId)
  }

  /**
   * Route one user message to the live agent: steering while a turn runs, an
   * ordinary follow-up turn otherwise. Resolves after quiescence and flush.
   * @param message - identified prompt content and the source that supplied it.
   */
  async submit(message: UserMessage): Promise<void> {
    const agent = this.agent
    if (agent === undefined) return
    this.setRunning(true)
    if (agent.status === 'running') agent.steer(message)
    else agent.followup(message)
    await agent.whenIdle()
    await this.flush()
    this.setRunning(agent.status === 'running')
  }

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver (mention expansion).
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void {
    this.agent?.inject(message)
  }

  /**
   * Queue one message as the next turn (Codex's Tab-while-running). While the
   * agent runs, the message waits for the current turn to settle and then
   * opens an ordinary follow-up turn; while idle it submits immediately. A
   * new queue replaces any previously queued message.
   * @param message - the prompt to run after the current turn.
   */
  queue(message: UserMessage): void {
    const agent = this.agent
    if (agent === undefined) return
    if (agent.status !== 'running') {
      void this.submit(message)
      return
    }
    this.queued = message
    this.callbacks.onQueueChange?.(true)
    void agent.whenIdle().then(async () => {
      const drained = this.queued
      if (drained === undefined) return
      this.queued = undefined
      await this.submit(drained)
      this.callbacks.onQueueChange?.(false)
    })
  }

  /** Cancel the live agent's current turn; the first Ctrl+C only cancels the run. */
  cancel(): void {
    this.agent?.cancel({ kind: 'user' })
  }

  /**
   * Wait for quiescence and flush, for surfaces whose commands wake the agent
   * themselves (custom slash commands).
   */
  async settle(): Promise<void> {
    const agent = this.agent
    if (agent === undefined) return
    this.setRunning(agent.status === 'running')
    await agent.whenIdle()
    await this.flush()
    this.setRunning(agent.status === 'running')
  }

  /** Flush the live session through its persistence backend. */
  async flush(): Promise<void> {
    const agent = this.agent
    if (agent !== undefined) await this.sessions.flush(agent.session)
  }

  /**
   * Clean exit: cancel a running turn, wait for quiescence, flush, dispose the
   * agent, and detach every listener. Safe to call with no live agent.
   */
  async shutdown(): Promise<void> {
    const agent = this.agent
    if (agent !== undefined) {
      if (agent.status === 'running') agent.cancel({ kind: 'user' })
      await agent.whenIdle()
      await this.flush()
    }
    await this.disposeAgent()
    this.detachListeners()
  }

  private setRunning(running: boolean): void {
    if (this.running === running) return
    this.running = running
    this.callbacks.onRunningChange?.(running)
  }

  private async disposeAgent(): Promise<void> {
    await this.handle?.dispose()
    this.handle = undefined
    this.agent = undefined
    if (this.queued !== undefined) {
      this.queued = undefined
      this.callbacks.onQueueChange?.(false)
    }
  }

  private detachListeners(): void {
    if (this.listenersDetached) return
    this.listenersDetached = true
    for (const dispose of this.disposers) dispose()
  }

  private async createAgent(resumeSessionId: string): Promise<AgentHandle> {
    const agents = this.ctx.get('agents')
    if (agents === undefined) throw new Error('tui-runner: the agents registry is not mounted')
    const selected = this.selectionRef.current
    if (selected === undefined) throw new Error('tui-runner: no model selection')
    const setup = (agentCtx: Context): void => {
      installModelSelection(agentCtx, this.selectionRef)
    }
    const agentOptions = { provider: selected.provider, model: selected.model }
    if (resumeSessionId !== '') {
      return agents.resume({ resumeSessionId: SessionId(resumeSessionId), agentOptions, setup })
    }
    return agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    })
  }
}
