import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { WorkerThreadFactory } from '../../lazy-worker-thread-host'
import { WorkerThreadRequestQueue } from '../../worker-thread-request-queue'
import {
  currentWorkerEntryLayout,
  resolveWorkerThreadEntryPath
} from '../../worker-thread-entry-path'
import type {
  ScriptSandboxWorkerRequest,
  ScriptSandboxWorkerResponse
} from './script-sandbox-worker-protocol'
import {
  emptyScriptOutput,
  SCRIPT_TIMEOUT_MS,
  type ScriptInput,
  type ScriptOutput
} from './script-sandbox-types'

export const SCRIPT_SANDBOX_WORKER_ENTRY_FILENAME = 'script-sandbox-worker-entry.js'

const IDLE_TEARDOWN_MS = 60_000
const MAX_CONSECUTIVE_DEATHS = 3
// QuickJS stops a runaway script itself; this is the backstop for a wedged thread.
const WORKER_GRACE_MS = 5_000

export class ScriptSandboxUnavailableError extends Error {}

/** What request execution needs from a sandbox; tests run scripts in-process through it. */
export type ScriptRunner = { run: (input: ScriptInput) => Promise<ScriptOutput> }

function defaultWorkerFactory(): Worker {
  const workerPath = resolveWorkerThreadEntryPath(
    currentWorkerEntryLayout(__dirname),
    SCRIPT_SANDBOX_WORKER_ENTRY_FILENAME
  )
  if (!existsSync(workerPath)) {
    throw new Error(`Script sandbox worker entry not found: ${workerPath}`)
  }
  return new Worker(workerPath)
}

/**
 * Runs scripts one at a time on a lazily spawned worker. A dead or missing worker rejects, and the
 * caller records `script-error`; scripts are never evaluated on the main thread as a fallback.
 */
export class ScriptSandboxClient implements ScriptRunner {
  private readonly queue: WorkerThreadRequestQueue<
    ScriptSandboxWorkerRequest,
    ScriptSandboxWorkerResponse
  >

  constructor(
    options: { workerFactory?: WorkerThreadFactory; log?: (message: string) => void } = {}
  ) {
    const log = options.log ?? ((message: string) => console.warn(message))
    this.queue = new WorkerThreadRequestQueue({
      factory: options.workerFactory ?? defaultWorkerFactory,
      idleTeardownMs: IDLE_TEARDOWN_MS,
      maxConsecutiveDeaths: MAX_CONSECUTIVE_DEATHS,
      createUnavailableError: (message) => new ScriptSandboxUnavailableError(message),
      describeTimeout: (timeoutMs) => `Script sandbox did not answer within ${timeoutMs}ms`,
      describeExit: (code) => `Script sandbox exited with code ${code}`,
      describeCrashLoop: (lastError) => `Script sandbox crashed repeatedly (${lastError})`,
      onUnavailable: (error) =>
        log(
          `[api-client] script sandbox unavailable; scripts will fail. ${error instanceof Error ? error.message : String(error)}`
        )
    })
  }

  /** Never rejects: a sandbox fault becomes the script's own error so the request can report it. */
  async run(input: ScriptInput): Promise<ScriptOutput> {
    try {
      const response = await this.queue.dispatch(
        (id) => ({ id, input }),
        (input.timeoutMs ?? SCRIPT_TIMEOUT_MS) + WORKER_GRACE_MS
      )
      return response.ok
        ? response.output
        : emptyScriptOutput({ name: 'SandboxError', message: response.error })
    } catch (error) {
      return emptyScriptOutput({
        name: 'SandboxError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
