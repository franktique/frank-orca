// Unexpected-401 handling: which run inputs to ask for, and applying the answer (FR-015, R14).
import type { Auth } from '../../shared/api-client/api-client-types'
import type { TestPlanStep } from '../../shared/test-orchestrator/test-orchestrator-types'
import type { RunInput, RunVariableScope } from './run-variable-scope'
import type { StepHookContext } from './test-run-step-executor'

const AUTH_LIKE_HEADER = /auth|token|api[-_]?key|cookie|session|secret/i
const TEMPLATE_NAME = /\{\{\s*([^{}\s]+)\s*\}\}/g

function authTexts(auth: Auth | undefined): string[] {
  return auth && auth.type !== 'inherit' && auth.type !== 'noauth' ? Object.values(auth.params) : []
}

/** Names of run inputs the step's auth or auth-like headers reference; all secrets when none. */
export function listAuthInputs(
  step: TestPlanStep,
  inputs: readonly RunInput[]
): { name: string; secret: boolean }[] {
  const texts: string[] = []
  for (const { snapshot, scope } of step.requests) {
    texts.push(...authTexts(snapshot.auth))
    for (const header of snapshot.headers) {
      if (header.enabled && AUTH_LIKE_HEADER.test(header.key)) {
        texts.push(header.value)
      }
    }
    if (!snapshot.auth || snapshot.auth.type === 'inherit') {
      const inherited = scope.folders.toReversed().map((folder) => folder.auth)
      const source = [...inherited, scope.collection.auth].find(
        (auth) => auth && auth.type !== 'inherit'
      )
      texts.push(...authTexts(source))
    }
  }
  const referenced = new Set(
    texts.flatMap((text) => [...text.matchAll(TEMPLATE_NAME)].map((match) => match[1]))
  )
  const matched = inputs.filter((input) => referenced.has(input.name))
  const chosen = matched.length > 0 ? matched : inputs.filter((input) => input.secret)
  return chosen.map(({ name, secret }) => ({ name, secret }))
}

/** True when the user supplied new values (re-send the step); false on Stop or an aborted run. */
export async function askForCredentials(
  deps: {
    pause: StepHookContext['pause']
    inputs: readonly RunInput[]
    scope: RunVariableScope
    requestStop: () => void
  },
  step: TestPlanStep
): Promise<boolean> {
  const listed = listAuthInputs(step, deps.inputs)
  let answer
  try {
    answer = await deps.pause({ kind: 'credentials', stepId: step.stepId, inputs: listed })
  } catch {
    // Why: Stop rejects the waiting pause, so the run is already stopping.
    return false
  }
  if (answer.kind !== 'credentials' || answer.action === 'stop') {
    deps.requestStop()
    return false
  }
  for (const input of listed) {
    const value = answer.values[input.name]
    if (value !== undefined) {
      deps.scope.setInput(input.name, value, input.secret)
    }
  }
  return true
}
