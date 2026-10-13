import releaseSyncVariant from '@jitl/quickjs-singlefile-cjs-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule
} from 'quickjs-emscripten'
import { CHAI_BUNDLE_SOURCE } from './chai-bundle-source'
import { PM_API_SHIM_SOURCE, SANDBOX_POLYFILLS_SOURCE } from './pm-api-shim'
import {
  emptyScriptOutput,
  SCRIPT_MEMORY_LIMIT_BYTES,
  SCRIPT_TIMEOUT_MS,
  type ScriptInput,
  scriptOutputSchema,
  type ScriptOutput
} from './script-sandbox-types'

let quickJsModule: Promise<QuickJSWASMModule> | null = null

// Why the single-file variant: the wasm is embedded in the JS, so packaging needs no extra asset
// and a worker inside app.asar never has to locate a .wasm file.
function loadQuickJs(): Promise<QuickJSWASMModule> {
  quickJsModule ??= newQuickJSWASMModuleFromVariant(releaseSyncVariant)
  return quickJsModule
}

type EvalFailure = { name: string; message: string }

function evalSource(vm: QuickJSContext, source: string, filename: string): EvalFailure | null {
  const result = vm.evalCode(source, filename)
  if (result.error) {
    const dumped: unknown = vm.dump(result.error)
    result.error.dispose()
    return normalizeFailure(dumped)
  }
  result.value.dispose()
  return null
}

function normalizeFailure(dumped: unknown): EvalFailure {
  if (typeof dumped === 'object' && dumped !== null) {
    const name = 'name' in dumped && typeof dumped.name === 'string' ? dumped.name : 'Error'
    const message = 'message' in dumped && typeof dumped.message === 'string' ? dumped.message : ''
    return { name, message }
  }
  return { name: 'Error', message: String(dumped) }
}

function readString(vm: QuickJSContext, source: string): string | null {
  const result = vm.evalCode(source, 'orca-finish.js')
  if (result.error) {
    result.error.dispose()
    return null
  }
  const text: unknown = vm.dump(result.value)
  result.value.dispose()
  return typeof text === 'string' ? text : null
}

function describeFailure(failure: EvalFailure, timeoutMs: number): EvalFailure {
  if (/interrupted/i.test(failure.message)) {
    return {
      name: 'TimeoutError',
      message: `The script ran for more than ${timeoutMs / 1000} seconds and was stopped.`
    }
  }
  if (/out of memory/i.test(failure.message)) {
    return { name: 'MemoryError', message: 'The script used too much memory and was stopped.' }
  }
  return failure
}

function parseOutput(text: string | null): ScriptOutput {
  if (text === null) {
    return emptyScriptOutput()
  }
  const parsed = scriptOutputSchema.safeParse(JSON.parse(text))
  return parsed.success
    ? parsed.data
    : emptyScriptOutput({ name: 'Error', message: 'The script result could not be read.' })
}

/**
 * Runs one script in a fresh QuickJS context. Nothing from the host is reachable: no fs, no
 * network, no timers, only the `pm` API described in contracts/script-sandbox-api.md.
 */
export async function runScript(input: ScriptInput): Promise<ScriptOutput> {
  const timeoutMs = input.timeoutMs ?? SCRIPT_TIMEOUT_MS
  const quickJs = await loadQuickJs()
  const runtime = quickJs.newRuntime()
  runtime.setMemoryLimit(input.memoryLimitBytes ?? SCRIPT_MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(1024 * 1024)
  let deadline = Date.now() + timeoutMs
  const interrupt = shouldInterruptAfterDeadline(deadline)
  runtime.setInterruptHandler((rt) => (Date.now() > deadline ? true : interrupt(rt)))
  const vm = runtime.newContext()

  try {
    for (const [source, filename] of [
      [SANDBOX_POLYFILLS_SOURCE, 'orca-polyfills.js'],
      [CHAI_BUNDLE_SOURCE, 'chai.js']
    ] as const) {
      const failure = evalSource(vm, source, filename)
      if (failure) {
        return emptyScriptOutput(failure)
      }
    }
    const inputHandle = vm.newString(JSON.stringify(input))
    vm.setProp(vm.global, '__orcaInput', inputHandle)
    inputHandle.dispose()
    const shimFailure = evalSource(vm, PM_API_SHIM_SOURCE, 'orca-pm.js')
    if (shimFailure) {
      return emptyScriptOutput(shimFailure)
    }

    let failure = evalSource(vm, input.script, 'script.js')
    if (!failure) {
      // Promise-returning tests settle in the job queue.
      const jobs = runtime.executePendingJobs()
      if (jobs.error) {
        const dumped: unknown = vm.dump(jobs.error)
        jobs.error.dispose()
        failure = normalizeFailure(dumped)
      }
    }
    const finalFailure = failure ? describeFailure(failure, timeoutMs) : null
    // Why reset: a timed-out script leaves the deadline in the past, which would also stop the
    // collection of whatever tests and logs it produced before that.
    deadline = Date.now() + 1000
    if (finalFailure) {
      const message = JSON.stringify([finalFailure.name, finalFailure.message])
      evalSource(vm, `__orcaSetError(...${message})`, 'orca-error.js')
    }
    const output = parseOutput(readString(vm, '__orcaFinish()'))
    return finalFailure ? { ...output, error: finalFailure } : output
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}
