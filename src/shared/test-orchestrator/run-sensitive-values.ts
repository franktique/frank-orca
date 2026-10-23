import {
  collectSecretValues,
  maskHeaders,
  maskSecrets,
  variants
} from '../api-client/secret-masking'
import type { Environment } from '../api-client/api-client-types'

const AUTH_HEADER_NAMES = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key'])
const AUTH_HEADER_SUFFIXES = ['-token', '-key', '-secret']
const SENSITIVE_VARIABLE_NAME = /token|secret|password|key/i

export function isAuthHeaderName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    AUTH_HEADER_NAMES.has(lower) || AUTH_HEADER_SUFFIXES.some((suffix) => lower.endsWith(suffix))
  )
}

export function isSensitiveVariableName(name: string): boolean {
  return SENSITIVE_VARIABLE_NAME.test(name)
}

function decodeBase64(payload: string): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** The whole header value plus the pieces that can show up alone (scheme payload, cookie values). */
function sensitivePartsOfHeader(name: string, value: string): string[] {
  const parts = [value]
  const scheme = /^(Bearer|Basic)\s+(\S+)$/i.exec(value)
  if (scheme) {
    parts.push(scheme[2])
    const decoded = scheme[1].toLowerCase() === 'basic' ? decodeBase64(scheme[2]) : null
    if (decoded) {
      parts.push(decoded)
      const separator = decoded.indexOf(':')
      if (separator !== -1) {
        parts.push(decoded.slice(separator + 1))
      }
    }
  }
  if (name.toLowerCase() === 'cookie') {
    for (const pair of value.split(';')) {
      const separator = pair.indexOf('=')
      if (separator !== -1) {
        parts.push(pair.slice(separator + 1).trim())
      }
    }
  }
  return parts.filter((part) => part.length > 0)
}

export type RunSensitiveValues = {
  addSecret: (value: string) => void
  addEnvironment: (environment: Pick<Environment, 'variables'> | null) => void
  addSentHeaders: (headers: readonly [string, string][]) => void
  addCaptured: (variable: string, value: string) => void
  maskText: (text: string) => string
  maskHeaders: (headers: readonly [string, string][]) => [string, string][]
  values: () => string[]
}

/** The set only grows during a run (FR-025, FR-025a); every spelling comes from `variants()`. */
export function createRunSensitiveValues(): RunSensitiveValues {
  const expanded = new Set<string>()

  const addSecret = (value: string): void => {
    if (value) {
      variants(value).forEach((entry) => expanded.add(entry))
    }
  }

  return {
    addSecret,
    addEnvironment: (environment) => collectSecretValues(environment).forEach(addSecret),
    addSentHeaders: (headers) => {
      for (const [name, value] of headers) {
        if (isAuthHeaderName(name)) {
          sensitivePartsOfHeader(name, value).forEach(addSecret)
        }
      }
    },
    addCaptured: (variable, value) => {
      if (isSensitiveVariableName(variable)) {
        addSecret(value)
      }
    },
    maskText: (text) => maskSecrets(text, [...expanded]),
    maskHeaders: (headers) => maskHeaders(headers, [...expanded]),
    values: () => [...expanded]
  }
}
