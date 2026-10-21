import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { RunSetupModel } from '../../../../../preload/api/test-run-api'

type TestRunDataChangeApprovalsProps = {
  steps: RunSetupModel['steps']
  dataChangingSteps: RunSetupModel['dataChangingSteps']
  approved: readonly string[]
  onToggle: (stepId: string, approved: boolean) => void
}

/** Per-step opt-in for steps whose queries change database data (FR-009). */
export default function TestRunDataChangeApprovals({
  steps,
  dataChangingSteps,
  approved,
  onToggle
}: TestRunDataChangeApprovalsProps): React.JSX.Element | null {
  if (dataChangingSteps.length === 0) {
    return null
  }
  return (
    <section
      className="space-y-2"
      aria-label={translate('apiClient.testRun.approvals.title', 'Steps that change data')}
    >
      <h3 className="text-sm font-medium">
        {translate('apiClient.testRun.approvals.title', 'Steps that change data')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {translate(
          'apiClient.testRun.approvals.hint',
          'Unapproved steps are skipped when the database is not local.'
        )}
      </p>
      {dataChangingSteps.map(({ stepId, queryIds }) => {
        const id = `test-run-approve-${stepId}`
        const title = steps.find((step) => step.stepId === stepId)?.title ?? stepId
        return (
          <div key={stepId} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={approved.includes(stepId)}
              onCheckedChange={(checked) => onToggle(stepId, checked === true)}
            />
            <Label htmlFor={id}>
              {translate(
                'apiClient.testRun.approvals.step',
                'Allow {{title}} ({{count}} data-changing queries)',
                { title, count: queryIds.length }
              )}
            </Label>
          </div>
        )
      })}
    </section>
  )
}
