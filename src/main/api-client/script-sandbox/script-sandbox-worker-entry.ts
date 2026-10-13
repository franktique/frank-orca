import { parentPort } from 'node:worker_threads'
import { runScript } from './script-sandbox-runner'
import type {
  ScriptSandboxWorkerRequest,
  ScriptSandboxWorkerResponse
} from './script-sandbox-worker-protocol'

// Why a worker: user scripts are untrusted and may loop; QuickJS enforces its own limits, and this
// thread keeps even that work off the main-process event loop. Imports must stay electron-free —
// the build's plain-node-entry-guard enforces it for this entry.

if (!parentPort) {
  throw new Error('Script sandbox worker must run with a parent port.')
}
const port = parentPort

port.on('message', (request: ScriptSandboxWorkerRequest) => {
  runScript(request.input).then(
    (output) => {
      const response: ScriptSandboxWorkerResponse = { id: request.id, ok: true, output }
      port.postMessage(response)
    },
    (error: unknown) => {
      const response: ScriptSandboxWorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
      port.postMessage(response)
    }
  )
})
