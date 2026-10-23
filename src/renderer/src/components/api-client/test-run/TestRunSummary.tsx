import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { detectLanguage } from '@/lib/language-detect'
import { basename, getRelativePathInsideRoot } from '@/lib/path'
import type {
  RunEnding,
  TestRunSummary as TestRunSummaryModel
} from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import { formatDuration } from '../response-viewer/response-formatting'

function endingLabel(ending: RunEnding | null): string {
  switch (ending) {
    case 'passed':
      return translate('apiClient.testRun.ending.passed', 'All steps passed')
    case 'failed':
      return translate('apiClient.testRun.ending.failed', 'Finished with failures')
    case 'stopped-by-user':
      return translate('apiClient.testRun.ending.stopped', 'Stopped by user')
    case 'preflight-failed':
      return translate('apiClient.testRun.ending.preflight', 'Preflight failed')
    case 'error':
    case null:
      return translate('apiClient.testRun.ending.error', 'Ended with an error')
  }
}

type TestRunSummaryProps = {
  worktreeId: string
  run: TestRunSummaryModel
  onNewRun: () => void
}

export default function TestRunSummary({
  worktreeId,
  run,
  onNewRun
}: TestRunSummaryProps): React.JSX.Element {
  const openFile = useAppStore((state) => state.openFile)
  const worktree = useActiveWorktree()
  const count = (kind: string): number => run.steps.filter((step) => step.result === kind).length
  const memoryOnly = run.cleanup.notCleaned.some((value) => value.unavailable)
  const reportPath = run.evidence?.reportPath
  const [confirmForget, setConfirmForget] = useState(false)
  const [forgetting, setForgetting] = useState(false)

  // Why: forgetting loses the only record of what a failed cleanup left behind, so it needs a second click.
  const forgetCaptures = async (): Promise<void> => {
    if (!confirmForget) {
      setConfirmForget(true)
      return
    }
    setForgetting(true)
    await window.api.testRun.forgetCaptures({ worktreeId, collectionId: run.collectionId })
    setForgetting(false)
    setConfirmForget(false)
    onNewRun()
  }

  const openEvidence = (): void => {
    if (!reportPath) {
      return
    }
    openFile({
      filePath: reportPath,
      relativePath:
        getRelativePathInsideRoot(reportPath, worktree?.path ?? null) ?? basename(reportPath),
      worktreeId,
      language: detectLanguage(reportPath),
      mode: 'edit'
    })
  }

  return (
    <section
      className="space-y-3 rounded-md border border-border p-3 text-xs"
      aria-label={translate('apiClient.testRun.summary.title', 'Summary')}
    >
      <p className="text-sm font-medium">{endingLabel(run.ending)}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          {translate('apiClient.testRun.summary.passed', 'Passed: {{n}}', { n: count('pass') })}
        </span>
        <span>
          {translate('apiClient.testRun.summary.failed', 'Failed: {{n}}', { n: count('fail') })}
        </span>
        <span>
          {translate('apiClient.testRun.summary.skipped', 'Skipped: {{n}}', {
            n: count('skipped')
          })}
        </span>
        <span>
          {translate('apiClient.testRun.summary.blocked', 'Blocked: {{n}}', {
            n: count('blocked')
          })}
        </span>
        {run.endedAt !== null ? (
          <span>
            {translate('apiClient.testRun.summary.duration', 'Duration: {{time}}', {
              time: formatDuration(Math.max(0, run.endedAt - run.startedAt - run.pausedMs))
            })}
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        <p>
          {translate('apiClient.testRun.summary.cleaned', 'Cleaned up: {{n}}', {
            n: run.cleanup.cleaned
          })}
        </p>
        {run.cleanup.keptByUser ? (
          <p className="text-muted-foreground">
            {translate('apiClient.testRun.summary.kept', 'Data was kept at your request.')}
          </p>
        ) : null}
        {run.cleanup.notCleaned.length > 0 ? (
          <div>
            <p className="text-destructive">
              {translate('apiClient.testRun.summary.notCleaned', 'Not cleaned up:')}
            </p>
            <ul className="font-mono">
              {run.cleanup.notCleaned.map((value) => (
                <li key={`${value.variable}:${value.valueMasked}`}>
                  {value.variable} = {value.valueMasked}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {memoryOnly ? (
        <p role="alert" className="text-destructive">
          {translate(
            'apiClient.testRun.summary.memoryOnly',
            'Some captured values are held in memory only and will not survive a restart.'
          )}
        </p>
      ) : null}
      {run.evidence?.ignoredByGit ? (
        <p className="text-muted-foreground">
          {translate(
            'apiClient.testRun.summary.ignored',
            'The evidence folder is ignored by source control.'
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {reportPath ? (
          <Button size="sm" onClick={openEvidence}>
            <FileText />
            {translate('apiClient.testRun.summary.openEvidence', 'Open evidence')}
          </Button>
        ) : null}
        {run.cleanup.notCleaned.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={forgetting}
            onClick={() => void forgetCaptures()}
          >
            {confirmForget
              ? translate('apiClient.testRun.summary.forgetConfirm', 'Confirm: forget values')
              : translate('apiClient.testRun.summary.forget', 'Forget captured values')}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onNewRun}>
          {translate('apiClient.testRun.summary.newRun', 'New run')}
        </Button>
      </div>
    </section>
  )
}
