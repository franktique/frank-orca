// One resolver for the renderer's unresolved-variable highlighting and the main-process sender,
// so what the user sees highlighted is exactly what fails to resolve at send time (R7).

export type VariableScope = {
  /** Debug label only (script, environment, folder, collection). */
  name: string
  variables: readonly { key: string; value: string | null; enabled?: boolean }[]
}

export type UnresolvedSpan = { name: string; start: number; end: number }

export type ResolvedText = { text: string; unresolved: UnresolvedSpan[] }

export type DynamicVariableSource = {
  uuid: () => string
  nowMs: () => number
  randomInt: () => number
}

const defaultDynamicSource: DynamicVariableSource = {
  uuid: () => globalThis.crypto.randomUUID(),
  nowMs: () => Date.now(),
  randomInt: () => Math.floor(Math.random() * 1001)
}

const TEMPLATE_PATTERN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g
const MAX_NESTING = 10

function lookup(name: string, scopes: readonly VariableScope[]): string | null {
  for (const scope of scopes) {
    let found: string | null | undefined
    for (const variable of scope.variables) {
      if (variable.enabled !== false && variable.key === name && variable.value !== null) {
        found = variable.value
      }
    }
    if (found !== undefined) {
      return found
    }
  }
  return null
}

function dynamicValue(name: string, source: DynamicVariableSource): string | null {
  switch (name) {
    case '$guid':
    case '$randomUUID':
      return source.uuid()
    case '$timestamp':
      return String(Math.floor(source.nowMs() / 1000))
    case '$isoTimestamp':
      return new Date(source.nowMs()).toISOString()
    case '$randomInt':
      return String(source.randomInt())
    default:
      return null
  }
}

function resolveValue(
  name: string,
  scopes: readonly VariableScope[],
  source: DynamicVariableSource,
  depth: number
): string | null {
  if (name.startsWith('$')) {
    return dynamicValue(name, source)
  }
  const value = lookup(name, scopes)
  if (value === null || depth >= MAX_NESTING) {
    return value
  }
  // Variables may reference other variables; the depth cap also stops cycles.
  return value.replace(TEMPLATE_PATTERN, (match, inner: string) => {
    return resolveValue(inner, scopes, source, depth + 1) ?? match
  })
}

/** Unknown names stay literal and are reported with their span in the *input* text. */
export function resolveTemplate(
  text: string,
  scopes: readonly VariableScope[],
  source: DynamicVariableSource = defaultDynamicSource
): ResolvedText {
  const unresolved: UnresolvedSpan[] = []
  const resolved = text.replace(TEMPLATE_PATTERN, (match, name: string, offset: number) => {
    const value = resolveValue(name, scopes, source, 0)
    if (value === null) {
      unresolved.push({ name, start: offset, end: offset + match.length })
      return match
    }
    return value
  })
  return { text: resolved, unresolved }
}

/** Names referenced by `text`, without resolving them (used to highlight in the editor). */
export function findUnresolvedVariables(
  text: string,
  scopes: readonly VariableScope[]
): UnresolvedSpan[] {
  return resolveTemplate(text, scopes).unresolved
}

export type ScopeChainInput = {
  scriptVariables?: readonly VariableScope['variables'][number][]
  environment?: readonly VariableScope['variables'][number][]
  /** Outermost folder first. */
  folders?: readonly { name: string; variables: VariableScope['variables'] }[]
  collection?: readonly VariableScope['variables'][number][]
}

/** Narrowest first: script → environment → folders (innermost first) → collection. */
export function buildScopeChain(input: ScopeChainInput): VariableScope[] {
  const scopes: VariableScope[] = []
  if (input.scriptVariables) {
    scopes.push({ name: 'script', variables: input.scriptVariables })
  }
  if (input.environment) {
    scopes.push({ name: 'environment', variables: input.environment })
  }
  for (const folder of (input.folders ?? []).toReversed()) {
    scopes.push({ name: `folder:${folder.name}`, variables: folder.variables })
  }
  if (input.collection) {
    scopes.push({ name: 'collection', variables: input.collection })
  }
  return scopes
}
