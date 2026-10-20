import { openRoutedHttpLink, type HttpLinkDestination } from '@/lib/http-link-destinations'

/** Destinations a quick link offers, preferred first; in-app tabs need a worktree to own them. */
export function quickLinkDestinations(
  openLinksInApp: boolean,
  activeWorktreeId: string | null
): HttpLinkDestination[] {
  if (!activeWorktreeId) {
    return ['system']
  }
  return openLinksInApp ? ['orca', 'system'] : ['system', 'orca']
}

export function openQuickLink(
  url: string,
  destination: HttpLinkDestination,
  activeWorktreeId: string | null
): void {
  openRoutedHttpLink(url, { worktreeId: activeWorktreeId ?? '', forceDestination: destination })
}
