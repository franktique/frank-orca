import type { RunSetupInput } from '../../../../../preload/api/test-run-api'

export type ResolvedTargets = {
  hosts: { host: string; local: boolean }[]
  unresolved: string[]
  refused?: { host: string; allowedHosts: string[] }
}

export type StartBlocker =
  | { kind: 'no-environment' }
  | { kind: 'missing-inputs'; names: string[] }
  | { kind: 'targets-pending' }
  | { kind: 'unresolved-hosts'; names: string[] }
  | { kind: 'refused-host'; host: string; allowedHosts: string[] }
  | { kind: 'unconfirmed-hosts'; hosts: string[] }
  | { kind: 'database-mode' }

export const isInputFilled = (input: RunSetupInput, typed: string | undefined): boolean =>
  Boolean(typed?.trim()) || (input.secret && input.hasRemembered)

export const nonLocalHosts = (targets: ResolvedTargets | null): string[] =>
  targets?.hosts.filter((host) => !host.local).map((host) => host.host) ?? []

export function computeStartBlockers(args: {
  environmentId: string | null
  inputs: readonly RunSetupInput[]
  typed: Record<string, string>
  targets: ResolvedTargets | null
  confirmedHosts: readonly string[]
  needsDatabaseMode: boolean
  databaseChosen: boolean
}): StartBlocker[] {
  if (!args.environmentId) {
    return [{ kind: 'no-environment' }]
  }
  const blockers: StartBlocker[] = []
  const missing = args.inputs
    .filter((input) => input.required && !isInputFilled(input, args.typed[input.name]))
    .map((input) => input.name)
  if (missing.length > 0) {
    blockers.push({ kind: 'missing-inputs', names: missing })
  }
  if (!args.targets) {
    // Why: the host guard cannot be evaluated until the main process has resolved the targets.
    blockers.push({ kind: 'targets-pending' })
  } else {
    if (args.targets.refused) {
      blockers.push({ kind: 'refused-host', ...args.targets.refused })
    }
    if (args.targets.unresolved.length > 0) {
      blockers.push({ kind: 'unresolved-hosts', names: args.targets.unresolved })
    }
    const unconfirmed = nonLocalHosts(args.targets).filter(
      (host) => !args.confirmedHosts.includes(host)
    )
    if (unconfirmed.length > 0) {
      blockers.push({ kind: 'unconfirmed-hosts', hosts: unconfirmed })
    }
  }
  if (args.needsDatabaseMode && !args.databaseChosen) {
    blockers.push({ kind: 'database-mode' })
  }
  return blockers
}
