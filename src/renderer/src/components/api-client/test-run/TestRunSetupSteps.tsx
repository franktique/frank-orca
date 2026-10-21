import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import type { RunSetupModel } from '../../../../../preload/api/test-run-api'
import { phaseLabel } from './test-run-phase-label'
import type { Phase } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

const PHASE_ORDER: Phase[] = ['preflight', 'setup', 'scenario', 'cleanup']

export default function TestRunSetupSteps({
  steps
}: {
  steps: RunSetupModel['steps']
}): React.JSX.Element {
  return (
    <section className="space-y-3" aria-label={translate('apiClient.testRun.steps.title', 'Steps')}>
      <h3 className="text-sm font-medium">{translate('apiClient.testRun.steps.title', 'Steps')}</h3>
      {PHASE_ORDER.map((phase) => {
        const inPhase = steps.filter((step) => step.phase === phase)
        if (inPhase.length === 0) {
          return null
        }
        return (
          <div key={phase} className="space-y-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {phaseLabel(phase)}
            </h4>
            <ul className="space-y-1 text-xs">
              {inPhase.map((step) => (
                <li key={step.stepId} className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{step.title}</span>
                    {step.queries.length > 0 ? (
                      <Badge variant="outline">
                        {translate('apiClient.testRun.steps.queries', '{{count}} queries', {
                          count: step.queries.length
                        })}
                      </Badge>
                    ) : null}
                  </div>
                  {step.problems.map((problem) => (
                    <p key={problem} className="text-destructive">
                      {problem}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
