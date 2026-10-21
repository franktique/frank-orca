import { translate } from '@/i18n/i18n'
import type { Phase } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'preflight':
      return translate('apiClient.testRun.phase.preflight', 'Preflight')
    case 'setup':
      return translate('apiClient.testRun.phase.setup', 'Setup')
    case 'scenario':
      return translate('apiClient.testRun.phase.scenario', 'Scenarios')
    case 'cleanup':
      return translate('apiClient.testRun.phase.cleanup', 'Cleanup')
  }
}
