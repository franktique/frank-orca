import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import ConnectionList from './ConnectionList'
import SavedQueryTree from './SavedQueryTree'
import SchemaBrowser from './SchemaBrowser'
import SqlSidebarSection from './SqlSidebarSection'

export default function SqlSidebarPanel({
  worktreeId,
  tabId
}: {
  worktreeId: string
  tabId: string
}): React.JSX.Element {
  const loadSnapshot = useAppStore((state) => state.loadSqlSnapshot)

  useEffect(() => {
    void loadSnapshot(worktreeId)
  }, [loadSnapshot, worktreeId])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-sleek" data-sql-sidebar>
      <SqlSidebarSection title={translate('sqlClient.sidebar.connections', 'Connections')}>
        <ConnectionList worktreeId={worktreeId} tabId={tabId} />
      </SqlSidebarSection>
      <SqlSidebarSection title={translate('sqlClient.sidebar.schema', 'Schema')}>
        <SchemaBrowser worktreeId={worktreeId} tabId={tabId} />
      </SqlSidebarSection>
      <SqlSidebarSection title={translate('sqlClient.sidebar.savedQueries', 'Saved Queries')}>
        <SavedQueryTree worktreeId={worktreeId} tabId={tabId} />
      </SqlSidebarSection>
    </div>
  )
}
