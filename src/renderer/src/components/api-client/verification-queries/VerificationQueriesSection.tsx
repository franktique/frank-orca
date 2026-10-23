import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { testRunKey } from '@/store/slices/api-client-test-run'
import { translate } from '@/i18n/i18n'
import type { ApiNodeId } from '../../../../../shared/api-client/api-client-types'
import type { VariableScope } from '../../../../../shared/api-client/variable-resolution'
import { describeApiClientFailure } from '../sidebar/use-api-client-tree-actions'
import VerificationQueryEditor from './VerificationQueryEditor'
import {
  listsForRequest,
  moveQuery,
  newVerificationQuery,
  type QueryGroup,
  type QueryLists
} from './verification-query-lists'

type VerificationQueriesSectionProps = {
  worktreeId: string
  collectionId: ApiNodeId
  requestId: ApiNodeId
  scopes: readonly VariableScope[]
}

const GROUPS: QueryGroup[] = ['before', 'after']

/** Before and After SQL lists for one request, saved into the collection's test map. */
export default function VerificationQueriesSection({
  worktreeId,
  collectionId,
  requestId,
  scopes
}: VerificationQueriesSectionProps): React.JSX.Element {
  const testMap = useAppStore(
    (state) => state.apiClientTestRunByTarget[testRunKey(worktreeId, collectionId)]?.testMap ?? null
  )
  const loadTestMap = useAppStore((state) => state.loadApiClientTestMap)
  const [lists, setLists] = useState<QueryLists>(() => listsForRequest(testMap, requestId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedAt = testMap?.loadedAt

  useEffect(() => {
    void loadTestMap(worktreeId, collectionId)
  }, [collectionId, loadTestMap, worktreeId])

  // Why: a reload (save, replace, re-import) is the new source of truth for this request.
  useEffect(() => {
    setLists(listsForRequest(testMap, requestId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the map version, not identity.
  }, [loadedAt, requestId])

  const saved = listsForRequest(testMap, requestId)
  const dirty = JSON.stringify(saved) !== JSON.stringify(lists)

  const update = (group: QueryGroup, next: QueryLists[QueryGroup]): void => {
    setError(null)
    setLists((current) => ({ ...current, [group]: next }))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const result = await window.api.testRun.saveQueries({
      worktreeId,
      collectionId,
      requestId,
      before: lists.before,
      after: lists.after,
      baseLoadedAt: loadedAt ?? 0
    })
    setSaving(false)
    if (result.ok) {
      void loadTestMap(worktreeId, collectionId)
    } else if (result.code === 'conflict') {
      setError(
        translate(
          'apiClient.verification.conflict',
          'The test map was replaced while you were editing. Your changes were not saved; reload the queries and try again.'
        )
      )
      void loadTestMap(worktreeId, collectionId)
    } else {
      setError(describeApiClientFailure(result))
    }
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <section key={group} className="space-y-2" aria-label={groupTitle(group)}>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {groupTitle(group)}
            </h4>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => update(group, [...lists[group], newVerificationQuery()])}
            >
              <Plus />
              {translate('apiClient.verification.add', 'Add query')}
            </Button>
          </div>
          {lists[group].length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate('apiClient.verification.empty', 'No queries.')}
            </p>
          ) : (
            lists[group].map((query, index) => (
              <VerificationQueryEditor
                key={query.id}
                query={query}
                index={index}
                count={lists[group].length}
                scopes={scopes}
                onChange={(next) =>
                  update(
                    group,
                    lists[group].map((item) => (item.id === next.id ? next : item))
                  )
                }
                onMove={(by) => update(group, moveQuery(lists[group], index, by))}
                onRemove={() =>
                  update(
                    group,
                    lists[group].filter((item) => item.id !== query.id)
                  )
                }
              />
            ))
          )}
        </section>
      ))}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button size="sm" variant="secondary" disabled={!dirty || saving} onClick={() => void save()}>
        {translate('apiClient.verification.save', 'Save queries')}
      </Button>
    </div>
  )
}

function groupTitle(group: QueryGroup): string {
  return group === 'before'
    ? translate('apiClient.verification.before', 'Before the request')
    : translate('apiClient.verification.after', 'After the request')
}
