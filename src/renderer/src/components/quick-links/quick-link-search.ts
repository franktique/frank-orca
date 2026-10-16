import type { QuickLink } from '../../../../shared/quick-link-types'

/** Case-insensitive substring filter over label + url, label matches ranked first. */
export function searchQuickLinks(links: readonly QuickLink[], rawQuery: string): QuickLink[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return [...links]
  }
  const ranked: { link: QuickLink; score: number; index: number }[] = []
  links.forEach((link, index) => {
    const score = link.label.toLowerCase().includes(query)
      ? 0
      : link.url.toLowerCase().includes(query)
        ? 1
        : -1
    if (score !== -1) {
      ranked.push({ link, score, index })
    }
  })
  ranked.sort((a, b) => a.score - b.score || a.index - b.index)
  return ranked.map((entry) => entry.link)
}
