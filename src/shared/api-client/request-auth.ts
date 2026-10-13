import type { ApiFolder, ApiRequest, Auth, Collection } from './api-client-types'
import { SUPPORTED_AUTH_TYPES } from './api-client-types'
import { resolveTemplate, type VariableScope } from './variable-resolution'

type AuthSource = Collection | ApiFolder | ApiRequest

/**
 * Nearest explicit auth wins: request → inner folder → outer folder → collection. `inherit` or
 * no auth keeps looking upward; `noauth` stops the search and means "send none".
 */
export function resolveEffectiveAuth(chainOuterToInner: readonly AuthSource[]): Auth | undefined {
  for (const source of chainOuterToInner.toReversed()) {
    if (!source.auth || source.auth.type === 'inherit') {
      continue
    }
    return source.auth.type === 'noauth' ? undefined : source.auth
  }
  return undefined
}

export function isAuthSupported(auth: Auth): boolean {
  return SUPPORTED_AUTH_TYPES.includes(auth.type)
}

export type AuthApplication = {
  header?: [string, string]
  query?: [string, string]
  unresolved: string[]
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/** Variables inside the auth fields resolve with the *request's* scopes (FR-012). */
export function buildAuthApplication(
  auth: Auth,
  scopes: readonly VariableScope[]
): AuthApplication {
  const unresolved: string[] = []
  const param = (name: string): string => {
    const result = resolveTemplate(auth.params[name] ?? '', scopes)
    unresolved.push(...result.unresolved.map((span) => span.name))
    return result.text
  }
  if (auth.type === 'bearer') {
    return { header: ['Authorization', `Bearer ${param('token')}`], unresolved }
  }
  if (auth.type === 'basic') {
    return {
      header: ['Authorization', `Basic ${toBase64(`${param('username')}:${param('password')}`)}`],
      unresolved
    }
  }
  if (auth.type === 'apikey') {
    const key = param('key')
    const value = param('value')
    return auth.params.in === 'query'
      ? { query: [key, value], unresolved }
      : { header: [key, value], unresolved }
  }
  return { unresolved }
}

export function appendQueryParam(url: string, name: string, value: string): string {
  const hashIndex = url.indexOf('#')
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?'
  return `${base}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}${hash}`
}
