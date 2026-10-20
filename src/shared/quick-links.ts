import type { QuickLink } from './quick-link-types'

export const MAX_QUICK_LINKS = 40
export const MAX_QUICK_LINK_ID_LENGTH = 80
export const MAX_QUICK_LINK_LABEL_LENGTH = 80
export const MAX_QUICK_LINK_URL_LENGTH = 2048

export type QuickLinkMutation = { type: 'upsert'; link: QuickLink } | { type: 'delete'; id: string }

export function getDefaultQuickLinks(): QuickLink[] {
  return []
}

// Why: "localhost:3000" is host:port, not a scheme, so a digit after the colon means no scheme.
const EXPLICIT_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i

/** Returns a canonical http(s) URL, or null when the input cannot be opened as a web link. */
export function normalizeQuickLinkUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_QUICK_LINK_URL_LENGTH) {
    return null
  }
  const candidate = EXPLICIT_SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export function normalizeQuickLinks(input: unknown): QuickLink[] {
  if (!Array.isArray(input)) {
    return []
  }

  const normalized: QuickLink[] = []
  const seenIds = new Set<string>()

  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const label: unknown = Reflect.get(item, 'label')
    const rawUrl: unknown = Reflect.get(item, 'url')
    const url = typeof rawUrl === 'string' ? normalizeQuickLinkUrl(rawUrl) : null
    if (!url) {
      continue
    }

    const rawIdValue: unknown = Reflect.get(item, 'id')
    const rawId = typeof rawIdValue === 'string' ? rawIdValue.trim() : ''
    const idBase = rawId || `quick-link-${normalized.length + 1}`
    let id = idBase.slice(0, MAX_QUICK_LINK_ID_LENGTH)
    let suffix = 2
    while (seenIds.has(id)) {
      id = `${idBase.slice(0, MAX_QUICK_LINK_ID_LENGTH - 4)}-${suffix}`
      suffix += 1
    }
    seenIds.add(id)

    const trimmedLabel = typeof label === 'string' ? label.trim() : ''
    normalized.push({
      id,
      label: (trimmedLabel || url).slice(0, MAX_QUICK_LINK_LABEL_LENGTH),
      url
    })

    if (normalized.length >= MAX_QUICK_LINKS) {
      break
    }
  }

  return normalized
}

export function applyQuickLinkMutation(
  links: readonly QuickLink[],
  mutation: QuickLinkMutation
): QuickLink[] {
  if (mutation.type === 'delete') {
    return links.filter((link) => link.id !== mutation.id)
  }
  const existingIndex = links.findIndex((link) => link.id === mutation.link.id)
  if (existingIndex === -1) {
    return [...links, mutation.link]
  }
  return links.map((link, index) => (index === existingIndex ? mutation.link : link))
}
