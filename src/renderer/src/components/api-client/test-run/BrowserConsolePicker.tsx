import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { DatabaseModeChoice } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

type ConsoleTab = { browserPageId: string; title: string; url: string }

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'not-found'; message: string; screenshot: string | null }
  | { kind: 'failed'; message: string }

type BrowserConsolePickerProps = {
  worktreeId: string
  rememberedOrigin?: string | null
  value: DatabaseModeChoice | null
  onChange: (choice: DatabaseModeChoice | null) => void
  onChooseAnotherMode: () => void
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export default function BrowserConsolePicker({
  worktreeId,
  rememberedOrigin = null,
  value,
  onChange,
  onChooseAnotherMode
}: BrowserConsolePickerProps): React.JSX.Element {
  const [tabs, setTabs] = useState<ConsoleTab[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' })

  const loadTabs = useCallback(async (): Promise<void> => {
    const result = await window.api.testRun.listConsoleTabs({ worktreeId })
    const list = result.ok ? result.tabs : []
    setTabs(list)
    setSelectedId((current) => {
      if (current && list.some((tab) => tab.browserPageId === current)) {
        return current
      }
      const remembered = list.find(
        (tab) => rememberedOrigin && originOf(tab.url) === rememberedOrigin
      )
      return remembered?.browserPageId ?? null
    })
  }, [worktreeId, rememberedOrigin])

  useEffect(() => {
    void loadTabs()
  }, [loadTabs])

  const selectedTab = tabs?.find((tab) => tab.browserPageId === selectedId) ?? null
  const selectedOrigin = selectedTab ? originOf(selectedTab.url) : null
  const confirmed = value?.mode === 'browser' && value.origin === selectedOrigin

  const selectTab = (tab: ConsoleTab): void => {
    setSelectedId(tab.browserPageId)
    setCheck({ kind: 'idle' })
    onChange(null)
  }

  const runCheck = async (): Promise<void> => {
    if (!selectedTab || !selectedOrigin) {
      return
    }
    const choice: DatabaseModeChoice = { mode: 'browser', origin: selectedOrigin }
    setCheck({ kind: 'checking' })
    onChange(null)
    const result = await window.api.testRun.testDatabase({
      worktreeId,
      mode: choice,
      browserPageId: selectedTab.browserPageId
    })
    if (result.ok) {
      setCheck({ kind: 'ok' })
      // Why: Start stays blocked until the console check passes, so the choice is only emitted here.
      onChange(choice)
    } else if (result.code === 'console-not-found') {
      setCheck({
        kind: 'not-found',
        message: result.message,
        screenshot: result.screenshot ?? null
      })
    } else {
      setCheck({ kind: 'failed', message: result.message })
    }
  }

  const cancel = (): void => {
    setSelectedId(null)
    setCheck({ kind: 'idle' })
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <Label>{translate('apiClient.testRun.database.consoleTab', 'Database console tab')}</Label>
      <p className="text-xs text-muted-foreground">
        {translate(
          'apiClient.testRun.database.browserHint',
          'Open your database console in an Orca browser tab, then pick it here. Sensitive values are blurred in console screenshots; a screenshot is withheld if they cannot be blurred.'
        )}
      </p>
      {tabs !== null && tabs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'apiClient.testRun.database.noTabs',
            'No browser tabs are open in this worktree.'
          )}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(tabs ?? []).map((tab) => (
            <Button
              key={tab.browserPageId}
              size="sm"
              variant={selectedId === tab.browserPageId ? 'secondary' : 'outline'}
              aria-pressed={selectedId === tab.browserPageId}
              title={tab.url}
              onClick={() => selectTab(tab)}
            >
              {tab.title || tab.url}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void loadTabs()}>
          {translate('apiClient.testRun.database.refreshTabs', 'Refresh tabs')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedOrigin || check.kind === 'checking' || confirmed}
          onClick={() => void runCheck()}
        >
          {translate('apiClient.testRun.database.checkConsole', 'Check console')}
        </Button>
        {check.kind === 'ok' ? (
          <span role="status" className="text-xs text-muted-foreground">
            {translate('apiClient.testRun.database.consoleOk', 'Console found.')}
          </span>
        ) : null}
        {check.kind === 'failed' ? (
          <span role="alert" className="text-xs text-destructive">
            {check.message}
          </span>
        ) : null}
      </div>
      {check.kind === 'not-found' ? (
        <div role="alert" className="space-y-2 rounded-md border border-border bg-card p-2">
          <p className="text-xs text-destructive">{check.message}</p>
          {check.screenshot ? (
            <img
              src={check.screenshot}
              alt={translate(
                'apiClient.testRun.database.consoleScreenshot',
                'Screenshot of the database console tab'
              )}
              className="max-h-64 w-full rounded-md border border-border object-contain"
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void runCheck()}>
              {translate('apiClient.testRun.database.checkAgain', 'Check again')}
            </Button>
            <Button size="sm" variant="outline" onClick={onChooseAnotherMode}>
              {translate('apiClient.testRun.database.chooseAnotherMode', 'Choose another mode')}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              {translate('apiClient.testRun.database.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
