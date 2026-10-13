import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { startEnvironmentDraft } from '@/store/slices/api-client-environment-draft'
import { RequestDraftNotices } from '../request-editor/RequestDraftNotices'
import VariablesTable from './VariablesTable'

const isMac = navigator.userAgent.includes('Mac')

type EnvironmentEditorProps = {
  tabId: string
  worktreeId: string
  environmentId: string
}

export default function EnvironmentEditor({
  tabId,
  worktreeId,
  environmentId
}: EnvironmentEditorProps): React.JSX.Element {
  const stored = useAppStore((state) =>
    state.apiClientSnapshotsByWorktree[worktreeId]?.environments.find(
      (env) => env.id === environmentId
    )
  )
  const draft = useAppStore((state) => {
    const candidate = state.apiClientDraftsByTab[tabId]
    return candidate?.kind === 'environment' ? candidate : undefined
  })
  const protection = useAppStore((state) => state.apiClientProtectionByWorktree[worktreeId])
  const edit = useAppStore((state) => state.editApiClientEnvironment)
  const reveal = useAppStore((state) => state.revealApiClientEnvironmentSecrets)
  const save = useAppStore((state) => state.saveApiClientDraft)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = isMac ? event.metaKey : event.ctrlKey
      if (
        modifier &&
        event.key.toLowerCase() === 's' &&
        useAppStore.getState().apiClientDraftsByTab[tabId]
      ) {
        event.preventDefault()
        void save(tabId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, tabId])

  if (!stored) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {translate('apiClient.environments.missing', 'This environment no longer exists.')}
      </div>
    )
  }
  const current = draft ?? startEnvironmentDraft(stored)
  const needsReentry = current.variables.some((variable) => variable.needsReentry)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <RequestDraftNotices tabId={tabId} subject="environment" />
      <div className="flex items-center gap-2">
        <Input
          value={current.name}
          aria-label={translate('apiClient.environments.environmentName', 'Environment name')}
          className="max-w-sm flex-1"
          onChange={(event) => edit(tabId, { name: event.target.value })}
        />
        <Button disabled={!draft} onClick={() => void save(tabId)}>
          {translate('apiClient.request.save', 'Save')}
        </Button>
      </div>
      {protection ? (
        <p className="text-xs text-muted-foreground" role="status">
          {protection.message}
        </p>
      ) : null}
      {needsReentry ? (
        <p className="text-xs text-muted-foreground" role="status">
          {translate(
            'apiClient.environments.reenterNotice',
            'Some secret values could not be read on this computer. Enter them again.'
          )}
        </p>
      ) : null}
      <VariablesTable
        variables={current.variables}
        onChange={(variables) => edit(tabId, { variables })}
        onReveal={(index) => void reveal(tabId, index)}
      />
    </div>
  )
}
