import type { ApiRequest, ScriptEvents } from './api-client-types'
import { SUPPORTED_AUTH_TYPES } from './api-client-types'

// Why static patterns: scripts run later in a sandbox, but the import report should name what
// will fail before the user presses Send (spec edge cases).
const UNSUPPORTED_SCRIPT_APIS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'pm.sendRequest', pattern: /\bpm\.sendRequest\b/ },
  { label: 'pm.visualizer', pattern: /\bpm\.visualizer\b/ },
  { label: 'pm.cookies', pattern: /\bpm\.cookies\b/ },
  { label: 'pm.require', pattern: /\bpm\.require\b/ },
  { label: 'setNextRequest', pattern: /\bsetNextRequest\b/ },
  { label: 'require()', pattern: /\brequire\s*\(\s*['"](?!chai['"])/ }
]

export const MAX_IMPORT_WARNINGS = 100

export function scanScriptWarnings(ownerName: string, events: ScriptEvents): string[] {
  const warnings: string[] = []
  for (const [phase, script] of Object.entries(events)) {
    const source = script?.exec.join('\n') ?? ''
    for (const api of UNSUPPORTED_SCRIPT_APIS) {
      if (api.pattern.test(source)) {
        warnings.push(`"${ownerName}" (${phase} script) uses ${api.label}, which is not supported.`)
      }
    }
  }
  return warnings
}

export function unsupportedFeatureWarnings(request: ApiRequest): string[] {
  const warnings: string[] = []
  if (request.auth && !SUPPORTED_AUTH_TYPES.includes(request.auth.type)) {
    warnings.push(
      `"${request.name}" uses ${request.auth.type} authentication, which cannot be sent yet. It is kept for export.`
    )
  }
  if (request.body?.mode === 'file' || request.body?.mode === 'graphql') {
    warnings.push(
      `"${request.name}" has a ${request.body.mode} body, which is sent as raw text and kept for export.`
    )
  }
  return warnings
}

export function capWarnings(warnings: string[]): string[] {
  if (warnings.length <= MAX_IMPORT_WARNINGS) {
    return warnings
  }
  const kept = warnings.slice(0, MAX_IMPORT_WARNINGS)
  kept.push(`${warnings.length - MAX_IMPORT_WARNINGS} more warnings were not listed.`)
  return kept
}
