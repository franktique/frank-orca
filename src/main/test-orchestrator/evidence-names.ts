// Windows-safe folder and image names for the evidence bundle (FR-021).
import { knownPhaseFromFolderName } from '../../shared/test-orchestrator/plan-phases'
import type { Phase } from '../../shared/test-orchestrator/test-orchestrator-types'

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

/** Filesystem-safe case sigla that keeps the original casing (`SC-1`, `S-1`). */
export function safeCaseName(stepId: string, fallback = 'step'): string {
  const name = stepId
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^[-.]+|[-.]+$/g, '')
  if (name === '') {
    return fallback
  }
  return WINDOWS_RESERVED_NAMES.test(name.toLowerCase()) ? `${name}-case` : name
}

/** The parts of a plan step that decide where its evidence goes; a `TestPlanStep` fits. */
export type EvidenceStep = {
  stepId: string
  phase: Phase
  requests: readonly { scope: { folders: readonly { name: string }[] } }[]
}

const DEFAULT_PHASE_FOLDER: Record<Phase, string> = {
  preflight: 'preflight',
  setup: 'setup',
  scenario: 'scenarios',
  cleanup: 'cleanup'
}

/** The collection folder that holds the step's phase (`setup`, `scenarios`, `cleanUp`), as named there. */
export function evidencePhaseFolder(step: EvidenceStep): string {
  const folders = step.requests[0]?.scope.folders ?? []
  const phaseFolder = folders.findLast(
    (folder) => knownPhaseFromFolderName(folder.name) === step.phase
  )
  return safeCaseName(phaseFolder?.name ?? '', DEFAULT_PHASE_FOLDER[step.phase])
}

/** `<phase>/<case>/<case>-<request|before-K|after-K>[-<n>].png`, relative to the run folder. */
export function evidenceImageName(step: EvidenceStep, role: EvidenceImageRole): string {
  const caseName = safeCaseName(step.stepId)
  const file =
    role.kind === 'request'
      ? `${caseName}-request${role.concurrentIndex === undefined ? '' : `-${role.concurrentIndex}`}.png`
      : `${caseName}-${role.kind}-${role.queryIndex}.png`
  return `${evidencePhaseFolder(step)}/${caseName}/${file}`
}
