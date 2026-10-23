import type { ApiRequest, Auth, EnvironmentVariable } from '../api-client/api-client-types'
import { resolveTemplate } from '../api-client/variable-resolution'
import type { RunInput, VerificationQuery } from './test-orchestrator-types'

/** Names used as `{{name}}` in `text`; dynamic `$` variables are not inputs. */
export function scanReferencedVariables(text: string): string[] {
  const names = resolveTemplate(text, []).unresolved.map((span) => span.name)
  return [...new Set(names.filter((name) => !name.startsWith('$')))]
}

function requestTexts(request: ApiRequest, effectiveAuth: Auth | undefined): string[] {
  const texts = [request.url.raw]
  texts.push(...request.url.query.filter((row) => row.enabled).flatMap((r) => [r.key, r.value]))
  texts.push(...request.pathVariables.filter((row) => row.enabled).map((row) => row.value))
  texts.push(...request.headers.filter((row) => row.enabled).flatMap((r) => [r.key, r.value]))
  const body = request.body
  if (body) {
    texts.push(body.raw ?? '', body.graphql?.query ?? '', body.graphql?.variables ?? '')
    const rows = [...(body.urlencoded ?? []), ...(body.formdata ?? [])]
    texts.push(...rows.filter((row) => row.enabled).flatMap((r) => [r.key, r.value]))
  }
  if (effectiveAuth) {
    texts.push(...Object.values(effectiveAuth.params))
  }
  return texts
}

/** Variables referenced by the URL, headers, body, auth, and path variables of a request. */
export function collectRequestVariables(
  request: ApiRequest,
  effectiveAuth: Auth | undefined
): string[] {
  return [...new Set(requestTexts(request, effectiveAuth).flatMap(scanReferencedVariables))]
}

export function collectQueryVariables(queries: readonly VerificationQuery[]): string[] {
  return [...new Set(queries.flatMap((query) => scanReferencedVariables(query.sql)))]
}

/** Empty enabled environment variables are one-time inputs (FR-004); `required` when referenced. */
export function deriveRunInputs(args: {
  environment: readonly EnvironmentVariable[]
  referenced: ReadonlySet<string>
  /** Plain and secret values already provided, by name. */
  provided?: Readonly<Record<string, string>>
}): RunInput[] {
  const inputs = new Map<string, RunInput>()
  for (const variable of args.environment) {
    if (!variable.enabled || variable.masked || (variable.value ?? '') !== '') {
      continue
    }
    // Last definition wins, as in variable lookup.
    inputs.set(variable.key, {
      name: variable.key,
      secret: variable.type === 'secret',
      required: args.referenced.has(variable.key),
      value: args.provided?.[variable.key] ?? ''
    })
  }
  return [...inputs.values()]
}
