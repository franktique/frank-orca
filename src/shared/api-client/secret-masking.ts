import { SECRET_MASK, type Environment } from './api-client-types'

// Why 4: a one- or two-character secret would also match inside unrelated text ("1" in every
// URL), so short values are masked only when they are the entire field.
const MIN_SUBSTRING_LENGTH = 4

export function variants(value: string): string[] {
  const percentEncoded = encodeURIComponent(value)
  return [
    value,
    percentEncoded,
    percentEncoded.replace(/%20/g, '+'),
    // JSON string escaping: a secret with quotes or backslashes appears escaped inside bodies.
    JSON.stringify(value).slice(1, -1)
  ]
}

/** Each secret value of `environment` plus its URL-encoded and JSON-escaped spellings. */
export function collectSecretValues(environment: Pick<Environment, 'variables'> | null): string[] {
  if (!environment) {
    return []
  }
  const values = new Set<string>()
  for (const variable of environment.variables) {
    if (variable.type === 'secret' && variable.enabled && variable.value) {
      variants(variable.value).forEach((entry) => values.add(entry))
    }
  }
  return [...values]
}

/** Longest value first, so a secret that contains another one is masked as a whole. */
export function maskSecrets(text: string, secretValues: readonly string[]): string {
  if (secretValues.length === 0 || text.length === 0) {
    return text
  }
  let masked = text
  for (const secret of [...secretValues].sort((a, b) => b.length - a.length)) {
    if (secret.length < MIN_SUBSTRING_LENGTH) {
      if (masked === secret) {
        masked = SECRET_MASK
      }
      continue
    }
    masked = masked.split(secret).join(SECRET_MASK)
  }
  return masked
}

/** `Basic <base64(user:pass)>` hides a secret password inside base64, so check the decoded form. */
export function maskAuthorizationHeader(header: string, secretValues: readonly string[]): string {
  const match = /^Basic\s+(\S+)$/i.exec(header)
  if (match) {
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))
      )
      if (maskSecrets(decoded, secretValues) !== decoded) {
        return `Basic ${SECRET_MASK}`
      }
    } catch {
      // Not valid base64: fall through to plain masking.
    }
  }
  return maskSecrets(header, secretValues)
}

/** Masks header values; the Authorization header gets the Basic-aware treatment. */
export function maskHeaders(
  headers: readonly [string, string][],
  secretValues: readonly string[]
): [string, string][] {
  return headers.map(([name, value]) => [
    name,
    name.toLowerCase() === 'authorization'
      ? maskAuthorizationHeader(value, secretValues)
      : maskSecrets(value, secretValues)
  ])
}
