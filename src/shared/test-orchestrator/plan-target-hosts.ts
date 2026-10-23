import type { Auth, EnvironmentVariable } from '../api-client/api-client-types'
import { isLocalHost } from '../host-locality'
import { prepareRequest } from '../api-client/request-preparation'
import { buildScopeChain } from '../api-client/variable-resolution'
import { resolveEffectiveAuth } from '../api-client/request-auth'
import type { TestPlanStep } from './test-orchestrator-types'

export type PlanTargetHost = { host: string; local: boolean }

export type PlanTargetHosts = {
  hosts: PlanTargetHost[]
  /** Variables a URL, header, body, or auth still lacks, excluding ones an earlier step captures. */
  unresolved: string[]
  refused: { host: string; allowedHosts: string[] } | null
}

function hostOf(url: string): string | null {
  if (url.includes('{{')) {
    return null
  }
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`).hostname || null
  } catch {
    return null
  }
}

/** Exact host, or `*.domain` for subdomains only (never the apex). */
export function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const lowered = host.toLowerCase()
  return allowedHosts.some((entry) => {
    const pattern = entry.trim().toLowerCase()
    return pattern.startsWith('*.')
      ? lowered.endsWith(pattern.slice(1)) && lowered.length > pattern.length - 1
      : lowered === pattern
  })
}

/** Resolves every request URL without sending, so the host guard can run before Start (R13). */
export function resolvePlanTargetHosts(args: {
  steps: readonly TestPlanStep[]
  environment: readonly EnvironmentVariable[]
  inputs: Readonly<Record<string, string>>
  allowedHosts?: readonly string[]
}): PlanTargetHosts {
  const inputVariables = Object.entries(args.inputs).map(([key, value]) => ({
    key,
    value,
    enabled: true
  }))
  const environment = [...args.environment, ...inputVariables]
  const hostNames = new Set<string>()
  const unresolved = new Set<string>()

  for (const step of args.steps) {
    const captured = new Set(step.requiredVariables)
    for (const { snapshot, scope } of step.requests) {
      const scopes = buildScopeChain({
        environment,
        folders: scope.folders,
        collection: scope.collection.variables
      })
      const effectiveAuth: Auth | undefined = resolveEffectiveAuth([
        scope.collection,
        ...scope.folders,
        snapshot
      ])
      const prepared = prepareRequest(snapshot, scopes, effectiveAuth)
      for (const name of prepared.unresolved) {
        if (!captured.has(name)) {
          unresolved.add(name)
        }
      }
      const host = hostOf(prepared.url)
      if (host) {
        hostNames.add(host)
      }
    }
  }

  const hosts = [...hostNames].map((host) => ({ host, local: isLocalHost(host) }))
  const allowed = args.allowedHosts ?? []
  const offender =
    allowed.length > 0 ? hosts.find(({ host }) => !isHostAllowed(host, allowed)) : undefined
  return {
    hosts,
    unresolved: [...unresolved],
    refused: offender ? { host: offender.host, allowedHosts: [...allowed] } : null
  }
}
