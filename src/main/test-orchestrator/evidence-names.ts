// Windows-safe folder and image names for the evidence bundle (FR-021).
const MAX_SLUG_LENGTH = 60
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/

export function slugifyForEvidence(text: string, fallback: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')
  if (slug === '') {
    return fallback
  }
  // Why: CON, NUL, etc. cannot be created as folders on Windows.
  return WINDOWS_RESERVED_NAMES.test(slug) ? `${slug}-plan` : slug
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Local `YYYY-MM-DD_HH-mm-ss`; no colons so the name is valid on Windows. */
export function formatRunFolderTimestamp(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export type EvidenceImageRole =
  | { kind: 'request'; concurrentIndex?: number }
  | { kind: 'before' | 'after'; queryIndex: number }

/** `NN-<step-slug>-<request|before-K|after-K>[-<n>].png` */
export function evidenceImageName(
  stepOrder: number,
  stepId: string,
  role: EvidenceImageRole
): string {
  const order = String(stepOrder).padStart(stepOrder >= 100 ? 3 : 2, '0')
  const stepSlug = slugifyForEvidence(stepId, 'step')
  if (role.kind === 'request') {
    const suffix = role.concurrentIndex === undefined ? '' : `-${role.concurrentIndex}`
    return `${order}-${stepSlug}-request${suffix}.png`
  }
  return `${order}-${stepSlug}-${role.kind}-${role.queryIndex}.png`
}
