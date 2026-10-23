import { describe, expect, it } from 'vitest'
import { derivePhaseFromFolderName } from './plan-phases'
import type { Phase } from './test-orchestrator-types'

const TABLE: Record<Phase, string[]> = {
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

describe('derivePhaseFromFolderName', () => {
  for (const [phase, names] of Object.entries(TABLE)) {
    it.each(names)(`maps "%s" to ${phase}`, (name) => {
      expect(derivePhaseFromFolderName(name)).toBe(phase)
    })
  }

  it('ignores case, accents, numbering and punctuation', () => {
    expect(derivePhaseFromFolderName('01 - Setup')).toBe('setup')
    expect(derivePhaseFromFolderName('2. Limpieza')).toBe('cleanup')
    expect(derivePhaseFromFolderName('Preparación')).toBe('setup')
    expect(derivePhaseFromFolderName('  VERIFICACIÓN PREVIA  ')).toBe('preflight')
    expect(derivePhaseFromFolderName('[03] Teardown:')).toBe('cleanup')
  })

  it('treats unknown folders as scenarios', () => {
    expect(derivePhaseFromFolderName('Payments')).toBe('scenario')
    expect(derivePhaseFromFolderName('')).toBe('scenario')
  })
})
