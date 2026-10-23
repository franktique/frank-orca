import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  BrowserRecoveryProblem,
  PauseAnswer
} from '../../../../../shared/test-orchestrator/test-orchestrator-types'

type TestRunBrowserRecoveryPauseProps = {
  worktreeId?: string
  problem: BrowserRecoveryProblem
  screenshot: string
  onAnswer: (answer: PauseAnswer) => void
}

type ConsoleTab = { browserPageId: string; title: string; url: string }

function describeProblem(problem: BrowserRecoveryProblem): string {
  switch (problem) {
    case 'not-found':
      return translate(
        'apiClient.testRun.recovery.notFound',
        'The query editor or run control was not found on the page.'
      )
    case 'error':
      return translate('apiClient.testRun.recovery.error', 'The console reported an error.')
    case 'sign-in':
      return translate('apiClient.testRun.recovery.signIn', 'The console is asking you to sign in.')
    case 'timeout':
      return translate(
        'apiClient.testRun.recovery.timeout',
        'The console did not return a result in time.'
      )
    case 'tab-closed':
      return translate('apiClient.testRun.recovery.tabClosed', 'The console tab was closed.')
  }
}

export default function TestRunBrowserRecoveryPause({
  worktreeId,
  problem,
  screenshot,
  onAnswer
}: TestRunBrowserRecoveryPauseProps): React.JSX.Element {
  const [tabs, setTabs] = useState<ConsoleTab[] | null>(null)

  useEffect(() => {
    if (!worktreeId) {
      return
    }
    let cancelled = false
    void window.api.testRun.listConsoleTabs({ worktreeId }).then((result) => {
      if (!cancelled) {
        setTabs(result.ok ? result.tabs : [])
      }
    })
    return () => {
      cancelled = true
    }
  }, [worktreeId])

  const answer = (
    action: Exclude<
      Extract<PauseAnswer, { kind: 'browser-recovery' }>,
      { action: 'pick-tab' }
    >['action']
  ): void => {
    onAnswer({ kind: 'browser-recovery', action })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{describeProblem(problem)}</p>
      {screenshot ? (
        <img
          src={screenshot}
          alt={translate('apiClient.testRun.recovery.screenshot', 'Screenshot of the console')}
          className="max-h-64 w-full rounded-md border border-border object-contain"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'apiClient.testRun.recovery.noScreenshot',
            'No screenshot is shown because sensitive values could not be blurred.'
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => answer('retry')}>
          {translate('apiClient.testRun.recovery.retry', 'Retry')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer('do-manually')}>
          {translate('apiClient.testRun.recovery.doManually', 'Do it manually')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer('skip')}>
          {translate('apiClient.testRun.recovery.skip', 'Skip this query')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer('switch-rest-to-manual')}>
          {translate('apiClient.testRun.recovery.restManual', 'Do the rest manually')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer('skip-remaining-queries')}>
          {translate('apiClient.testRun.recovery.skipRemaining', 'Skip remaining queries')}
        </Button>
      </div>
      {tabs && tabs.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {translate('apiClient.testRun.recovery.pickTab', 'Use a different tab')}
          </p>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <Button
                key={tab.browserPageId}
                size="sm"
                variant="outline"
                title={tab.url}
                onClick={() =>
                  onAnswer({
                    kind: 'browser-recovery',
                    action: 'pick-tab',
                    browserPageId: tab.browserPageId
                  })
                }
              >
                {tab.title || tab.url}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
