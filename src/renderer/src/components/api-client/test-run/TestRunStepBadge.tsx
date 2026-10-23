import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import type { StepResultKind } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

function stepResultLabel(result: StepResultKind): string {
  switch (result) {
    case 'pass':
      return translate('apiClient.testRun.result.pass', 'Passed')
    case 'fail':
      return translate('apiClient.testRun.result.fail', 'Failed')
    case 'skipped':
      return translate('apiClient.testRun.result.skipped', 'Skipped')
    case 'blocked':
      return translate('apiClient.testRun.result.blocked', 'Blocked')
    case 'running':
      return translate('apiClient.testRun.result.running', 'Running')
    case 'pending':
      return translate('apiClient.testRun.result.pending', 'Pending')
  }
}

export default function TestRunStepBadge({
  result
}: {
  result: StepResultKind
}): React.JSX.Element {
  const variant =
    result === 'fail' || result === 'blocked'
      ? 'destructive'
      : result === 'pass'
        ? 'secondary'
        : 'outline'
  return <Badge variant={variant}>{stepResultLabel(result)}</Badge>
}
