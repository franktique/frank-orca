import { useEffect, useState } from 'react'
import { FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import CollectionTree from './CollectionTree'
import EnvironmentList from './EnvironmentList'
import ExportDialog from './ExportDialog'
import ImportDialog from './ImportDialog'
import { useApiClientEnvironmentActions } from './use-api-client-environment-actions'
import { useApiClientExport } from './use-api-client-export'
import { useApiClientImport } from './use-api-client-import'
import { useApiClientTreeActions } from './use-api-client-tree-actions'

const SECTION_HEADING_CLASS =
  'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

export default function ApiClientSidebarPanel({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element {
  const snapshot = useAppStore((state) => state.apiClientSnapshotsByWorktree[worktreeId])
  const loadSnapshot = useAppStore((state) => state.loadApiClientSnapshot)
  const tabId = useAppStore((state) => state.getActiveTab(worktreeId)?.id ?? null)
  const view = useAppStore((state) => (tabId ? state.apiClientTabsById[tabId]?.view : undefined))
  const setView = useAppStore((state) => state.requestApiClientTabView)
  const importer = useApiClientImport(worktreeId)
  const exporter = useApiClientExport(worktreeId)
  const treeActions = useApiClientTreeActions(worktreeId)
  const environmentActions = useApiClientEnvironmentActions(worktreeId)
  const [query, setQuery] = useState('')
  const [renameRequestId, setRenameRequestId] = useState<string | null>(null)
  const [renameEnvironmentId, setRenameEnvironmentId] = useState<string | null>(null)

  useEffect(() => {
    void loadSnapshot(worktreeId)
  }, [loadSnapshot, worktreeId])

  const collections = snapshot?.collections ?? []
  const environments = snapshot?.environments ?? []

  const createCollection = async (): Promise<void> => {
    const id = await treeActions.createCollection()
    if (id) {
      setRenameRequestId(id)
    }
  }

  const createEnvironment = async (): Promise<void> => {
    const id = await environmentActions.create()
    if (id) {
      setRenameEnvironmentId(id)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-api-client-sidebar>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className={SECTION_HEADING_CLASS}>
          {translate('apiClient.sidebar.title', 'API Client')}
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={translate('apiClient.sidebar.newCollection', 'New collection')}
                onClick={() => void createCollection()}
              >
                <FolderPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {translate('apiClient.sidebar.newCollection', 'New collection')}
            </TooltipContent>
          </Tooltip>
          <Button variant="outline" size="xs" onClick={() => void importer.startImport()}>
            <Upload />
            {translate('apiClient.sidebar.import', 'Import')}
          </Button>
        </div>
      </div>

      <section
        aria-labelledby="api-client-collections-heading"
        className="flex min-h-0 flex-1 flex-col gap-2 px-2 py-3"
      >
        <h3 id="api-client-collections-heading" className={cn(SECTION_HEADING_CLASS, 'px-1')}>
          {translate('apiClient.sidebar.collections', 'Collections')}
        </h3>
        {collections.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            {translate(
              'apiClient.sidebar.collectionsEmpty',
              'No collections yet. Import a Postman collection to start.'
            )}
          </p>
        ) : (
          <>
            <div className="px-1">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate('apiClient.sidebar.searchPlaceholder', 'Filter requests')}
                aria-label={translate('apiClient.sidebar.searchPlaceholder', 'Filter requests')}
                className="h-8"
              />
            </div>
            <CollectionTree
              worktreeId={worktreeId}
              tabId={tabId}
              collections={collections}
              query={query}
              renameRequestId={renameRequestId}
              onExportCollection={(collectionId) => void exporter.exportCollection(collectionId)}
            />
          </>
        )}
      </section>

      <section
        aria-labelledby="api-client-environments-heading"
        className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-t border-border px-2 py-3 scrollbar-sleek"
      >
        <div className="flex items-center justify-between px-1">
          <h3 id="api-client-environments-heading" className={SECTION_HEADING_CLASS}>
            {translate('apiClient.sidebar.environments', 'Environments')}
          </h3>
          <Button variant="ghost" size="xs" onClick={() => void createEnvironment()}>
            {translate('apiClient.sidebar.newEnvironment', 'New')}
          </Button>
        </div>
        {environments.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            {translate(
              'apiClient.sidebar.environmentsEmpty',
              'No environments yet. Import a Postman environment file.'
            )}
          </p>
        ) : (
          <EnvironmentList
            environments={environments}
            activeEnvironmentId={snapshot?.activeEnvironmentId ?? null}
            selectedEnvironmentId={view?.kind === 'environment' ? view.environmentId : null}
            actions={environmentActions}
            renameRequestId={renameEnvironmentId}
            onExport={(environmentId) => void exporter.exportEnvironment(environmentId)}
            onOpen={(environmentId) => {
              if (tabId) {
                setView(tabId, { kind: 'environment', environmentId })
              }
            }}
          />
        )}
      </section>

      <ExportDialog
        state={exporter.state}
        onConfirmSecrets={() => void exporter.confirmSecretsExport()}
        onClose={exporter.close}
      />
      <ImportDialog
        state={importer.state}
        onResolveDuplicate={(mode) => void importer.resolveDuplicate(mode)}
        onClose={importer.close}
      />
    </div>
  )
}
