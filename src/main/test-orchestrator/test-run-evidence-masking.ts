import type {
  ExecutionOutcome,
  ResolvedRequest,
  TestResult
} from '../../shared/api-client/api-client-types'
import type { RunSensitiveValues } from '../../shared/test-orchestrator/run-sensitive-values'

/** Last line of defense: nothing reaches evidence without passing the run's growing masker (R9). */
export function maskResolvedRequest(
  sensitive: RunSensitiveValues,
  request: ResolvedRequest
): ResolvedRequest {
  return {
    method: request.method,
    url: sensitive.maskText(request.url),
    headers: sensitive.maskHeaders(request.headers),
    body: request.body === null ? null : sensitive.maskText(request.body)
  }
}

export function maskOutcome(
  sensitive: RunSensitiveValues,
  outcome: ExecutionOutcome
): ExecutionOutcome {
  if (outcome.kind === 'error') {
    return { ...outcome, message: sensitive.maskText(outcome.message) }
  }
  const { response } = outcome
  const { text } = response.body
  return {
    kind: 'response',
    response: {
      ...response,
      headers: sensitive.maskHeaders(response.headers),
      redirects: response.redirects.map((hop) => ({ ...hop, url: sensitive.maskText(hop.url) })),
      body:
        text === undefined ? response.body : { ...response.body, text: sensitive.maskText(text) }
    }
  }
}

export function maskTestResults(
  sensitive: RunSensitiveValues,
  tests: readonly TestResult[]
): TestResult[] {
  return tests.map((test) => ({
    ...test,
    name: sensitive.maskText(test.name),
    ...(test.error === undefined ? {} : { error: sensitive.maskText(test.error) })
  }))
}
