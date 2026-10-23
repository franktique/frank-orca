import type { Phase } from './test-orchestrator-types'

const PHASES: readonly Phase[] = ['preflight', 'setup', 'scenario', 'cleanup']

const PHASE_NAMES: Record<Phase, readonly string[]> = {
  preflight: [
    'preflight',
    'pre-flight',
    'precheck',
    'pre-check',
    'smoke',
    'verificacion previa',
    'prevalidacion',
    'comprobaciones'
  ],
  setup: [
    'setup',
    'set up',
    'arrange',
    'fixtures',
    'seed',
    'preparacion',
    'configuracion',
    'datos de prueba'
  ],
  scenario: [
    'scenarios',
    'scenario',
    'tests',
    'test cases',
    'cases',
    'escenarios',
    'casos',
    'casos de prueba',
    'pruebas'
  ],
  cleanup: ['cleanup', 'clean up', 'teardown', 'tear down', 'limpieza', 'borrado', 'eliminacion']
}

const PHASE_BY_NAME = new Map<string, Phase>(
  PHASES.flatMap((phase) => PHASE_NAMES[phase].map((name): [string, Phase] => [name, phase]))
)

// Why: folders are often numbered or decorated ("01 - Setup"), and Spanish names carry accents.
export function normalizePhaseFolderName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]*\d*[^\p{L}\p{N}]*/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The phase a folder name stands for, or null when the name is not a phase name. */
export function knownPhaseFromFolderName(name: string): Phase | null {
  return PHASE_BY_NAME.get(normalizePhaseFolderName(name)) ?? null
}

/** Unknown folders are scenarios. */
export function derivePhaseFromFolderName(name: string): Phase {
  return knownPhaseFromFolderName(name) ?? 'scenario'
}
