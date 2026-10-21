import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { DatabaseModeChoice } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import EnvironmentSelector from '../EnvironmentSelector'
import TestRunDataChangeApprovals from './TestRunDataChangeApprovals'
import TestRunInputsForm from './TestRunInputsForm'
import TestRunSetupSteps from './TestRunSetupSteps'
import type { StartBlocker } from './test-run-start-readiness'
import { nonLocalHosts } from './test-run-start-readiness'
import { useTestRunSetup } from './use-test-run-setup'

export type DatabaseModeSlotProps = {
  value: DatabaseModeChoice | null
  onChange: (choice: DatabaseModeChoice | null) => void
  rememberedMode: string | null
}

type TestRunSetupProps = {
  worktreeId: string
  collectionId: string
  /** Filled by the database-mode picker; hidden when the plan has no queries. */
  databaseModeSlot?: (props: DatabaseModeSlotProps) => React.ReactNode
}

function describeBlocker(blocker: StartBlocker): string {
  switch (blocker.kind) {
    case 'no-environment':
      return translate('apiClient.testRun.blocker.environment', 'Choose an environment.')
    case 'missing-inputs':
      return translate('apiClient.testRun.blocker.inputs', 'Fill in: {{names}}', {
        names: blocker.names.join(', ')
      })
    case 'targets-pending':
      return translate('apiClient.testRun.blocker.targetsPending', 'Checking the target host…')
    case 'unresolved-hosts':
      return translate('apiClient.testRun.blocker.unresolved', 'Could not resolve: {{names}}', {
        names: blocker.names.join(', ')
      })
    case 'refused-host':
      return translate(
        'apiClient.testRun.blocker.refused',
        'This run targets {{host}}, which is not in the test map allowed hosts: {{allowed}}.',
        { host: blocker.host, allowed: blocker.allowedHosts.join(', ') }
      )
    case 'unconfirmed-hosts':
      return translate('apiClient.testRun.blocker.confirmHosts', 'Confirm the target host.')
    case 'database-mode':
      return translate('apiClient.testRun.blocker.database', 'Choose how to run the queries.')
  }
}

export default function TestRunSetup({
  worktreeId,
  collectionId,
  databaseModeSlot
}: TestRunSetupProps): React.JSX.Element {
  const environmentId = useAppStore(
    (state) => state.apiClientSnapshotsByWorktree[worktreeId]?.activeEnvironmentId ?? null
  )
  const model = useTestRunSetup({
    worktreeId,
    collectionId,
    environmentId,
    databaseModeAvailable: Boolean(databaseModeSlot)
  })
  const { setup, blockers } = model
  const canStart = blockers.length === 0 && !model.starting
  const hosts = nonLocalHosts(model.targets)

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
      <div className="space-y-1">
        <Label>{translate('apiClient.testRun.environment', 'Environment')}</Label>
        <EnvironmentSelector worktreeId={worktreeId} />
      </div>
      {model.loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {model.loadError}
        </p>
      ) : null}
      {setup ? (
        <>
          <TestRunInputsForm
            inputs={setup.inputs}
            typed={model.typed}
            rememberInputs={model.rememberInputs}
            rememberSecrets={model.rememberSecrets}
            onTyped={model.setTyped}
            onRememberInputs={model.setRememberInputs}
            onRememberSecrets={model.setRememberSecrets}
            onClearRememberedSecrets={() => void model.clearRememberedSecrets()}
          />
          {setup.hasQueries && databaseModeSlot
            ? databaseModeSlot({
                value: model.database,
                onChange: model.setDatabase,
                rememberedMode: setup.rememberedMode
              })
            : null}
          {setup.hasQueries ? (
            <TestRunDataChangeApprovals
              steps={setup.steps}
              dataChangingSteps={setup.dataChangingSteps}
              approved={model.approvedSteps}
              onToggle={model.toggleApproval}
            />
          ) : null}
          <TestRunSetupSteps steps={setup.steps} />
          {model.targets ? (
            <section
              className="space-y-2"
              aria-label={translate('apiClient.testRun.targets.title', 'Target hosts')}
            >
              <h3 className="text-sm font-medium">
                {translate('apiClient.testRun.targets.title', 'Target hosts')}
              </h3>
              <p className="font-mono text-xs">
                {model.targets.hosts.map((target) => target.host).join(', ')}
              </p>
              {hosts.map((host) => (
                <div key={host} className="flex items-center gap-2">
                  <Checkbox
                    id={`test-run-confirm-${host}`}
                    checked={model.confirmedHosts.includes(host)}
                    onCheckedChange={(checked) => model.toggleHost(host, checked === true)}
                  />
                  <Label htmlFor={`test-run-confirm-${host}`}>
                    {translate(
                      'apiClient.testRun.targets.confirm',
                      'I confirm this run targets {{host}}',
                      { host }
                    )}
                  </Label>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      {blockers.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-live="polite">
          {blockers.map((blocker) => (
            <li
              key={blocker.kind}
              className={blocker.kind === 'refused-host' ? 'text-destructive' : undefined}
              role={blocker.kind === 'refused-host' ? 'alert' : undefined}
            >
              {describeBlocker(blocker)}
            </li>
          ))}
        </ul>
      ) : null}
      {model.startError ? (
        <p role="alert" className="text-sm text-destructive">
          {model.startError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!canStart} onClick={() => void model.start('full')}>
          <Play />
          {translate('apiClient.testRun.start', 'Start')}
        </Button>
        {setup && setup.uncleanedCaptures > 0 ? (
          <Button
            variant="outline"
            disabled={!canStart}
            onClick={() => void model.start('cleanup-only')}
          >
            {translate('apiClient.testRun.cleanupOnly', 'Run cleanup only')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
