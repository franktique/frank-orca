import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import BrowserConsolePicker from './BrowserConsolePicker'
import type { DatabaseModeChoice } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

type DatabaseModePickerProps = {
  worktreeId: string
  rememberedMode: string | null
  rememberedOrigin?: string | null
  value: DatabaseModeChoice | null
  onChange: (choice: DatabaseModeChoice | null) => void
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string }

type PickerMode = 'automatic' | 'browser' | 'manual'

export default function DatabaseModePicker({
  worktreeId,
  rememberedMode,
  rememberedOrigin = null,
  value,
  onChange
}: DatabaseModePickerProps): React.JSX.Element {
  const projectKey = useAppStore((state) => state.sqlProjectKeyByWorktree[worktreeId])
  const snapshot = useAppStore((state) =>
    projectKey ? state.sqlSnapshotsByProject[projectKey] : undefined
  )
  const loadSnapshot = useAppStore((state) => state.loadSqlSnapshot)
  // Why: Manual needs no setup, so it is the first-time default; Automatic only when remembered.
  const [mode, setMode] = useState<PickerMode>(
    rememberedMode === 'automatic' || rememberedMode === 'browser' ? rememberedMode : 'manual'
  )
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const connections = snapshot?.connections ?? []

  useEffect(() => {
    void loadSnapshot(worktreeId)
  }, [loadSnapshot, worktreeId])

  useEffect(() => {
    if (mode === 'manual' && value?.mode !== 'manual') {
      onChange({ mode: 'manual' })
    }
  }, [mode, value, onChange])

  const selectMode = (next: PickerMode): void => {
    setMode(next)
    setTest({ kind: 'idle' })
    if (next === 'manual') {
      onChange({ mode: 'manual' })
    } else {
      onChange(null)
    }
  }

  const chosenConnectionId = value?.mode === 'automatic' ? value.connectionId : null

  const runTest = async (): Promise<void> => {
    if (value?.mode !== 'automatic') {
      return
    }
    setTest({ kind: 'testing' })
    const result = await window.api.testRun.testDatabase({ worktreeId, mode: value })
    setTest(result.ok ? { kind: 'ok' } : { kind: 'failed', message: result.message })
  }

  return (
    <section
      className="space-y-2"
      aria-label={translate('apiClient.testRun.database.title', 'Database queries')}
    >
      <h3 className="text-sm font-medium">
        {translate('apiClient.testRun.database.title', 'Database queries')}
      </h3>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === 'automatic' ? 'secondary' : 'outline'}
          aria-pressed={mode === 'automatic'}
          onClick={() => selectMode('automatic')}
        >
          {translate('apiClient.testRun.database.automatic', 'Automatic')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'browser' ? 'secondary' : 'outline'}
          aria-pressed={mode === 'browser'}
          onClick={() => selectMode('browser')}
        >
          {translate('apiClient.testRun.database.browser', 'Browser')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'manual' ? 'secondary' : 'outline'}
          aria-pressed={mode === 'manual'}
          onClick={() => selectMode('manual')}
        >
          {translate('apiClient.testRun.database.manual', 'Manual')}
        </Button>
      </div>
      {mode === 'manual' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'apiClient.testRun.database.manualHint',
            'The run pauses at each step so you can run its queries yourself.'
          )}
        </p>
      ) : mode === 'browser' ? (
        <BrowserConsolePicker
          worktreeId={worktreeId}
          rememberedOrigin={rememberedOrigin}
          value={value}
          onChange={onChange}
          onChooseAnotherMode={() => selectMode('manual')}
        />
      ) : (
        <div className="space-y-2">
          <Label>{translate('apiClient.testRun.database.connection', 'SQL connection')}</Label>
          {connections.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'apiClient.testRun.database.noConnections',
                'No SQL connections in this project. Add one in a SQL tab first.'
              )}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connections.map((connection) => (
                <Button
                  key={connection.id}
                  size="sm"
                  variant={chosenConnectionId === connection.id ? 'secondary' : 'outline'}
                  aria-pressed={chosenConnectionId === connection.id}
                  onClick={() => {
                    setTest({ kind: 'idle' })
                    onChange({
                      mode: 'automatic',
                      connectionId: connection.id,
                      projectKey: snapshot?.projectKey ?? ''
                    })
                  }}
                >
                  {connection.name}
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={chosenConnectionId === null || test.kind === 'testing'}
              onClick={() => void runTest()}
            >
              {translate('apiClient.testRun.database.test', 'Test connection')}
            </Button>
            {test.kind === 'ok' ? (
              <span role="status" className="text-xs text-muted-foreground">
                {translate('apiClient.testRun.database.testOk', 'Connection works.')}
              </span>
            ) : null}
            {test.kind === 'failed' ? (
              <span role="alert" className="text-xs text-destructive">
                {test.message}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
