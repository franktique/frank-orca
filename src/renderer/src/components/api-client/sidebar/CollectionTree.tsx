import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { testRunKey } from '@/store/slices/api-client-test-run'
import { translate } from '@/i18n/i18n'
import type { Collection } from '../../../../../shared/api-client/api-client-types'
import { ConfirmDeleteDialog, MoveToDialog } from './CollectionTreeDialogs'
import CollectionTreeRow from './CollectionTreeRow'
import TestMapDialogs from './TestMapDialogs'
import { buildRequestMarkers, countBrokenLinks } from './test-map-markers'
import { useApiClientTestMapActions } from './use-api-client-test-map-actions'
import type { RowAction, TestMapMenuState } from './collection-tree-menu'
import { buildTreeRows, type TreeRow } from './collection-tree-rows'
import { useApiClientTreeActions } from './use-api-client-tree-actions'

const ROW_HEIGHT_PX = 28

type CollectionTreeProps = {
  worktreeId: string
  tabId: string | null
  collections: readonly Collection[]
  query: string
  /** A node created elsewhere (the New collection button) that should start in rename mode. */
  renameRequestId?: string | null
  onExportCollection?: (collectionId: string) => void
}

export default function CollectionTree({
  worktreeId,
  tabId,
  collections,
  query,
  renameRequestId = null,
  onExportCollection
}: CollectionTreeProps): React.JSX.Element {
  const actions = useApiClientTreeActions(worktreeId)
  const setView = useAppStore((state) => state.requestApiClientTabView)
  const selectedRequestId = useAppStore((state) => {
    const view = tabId ? state.apiClientTabsById[tabId]?.view : undefined
    return view?.kind === 'request' ? view.requestId : null
  })
  const testMapActions = useApiClientTestMapActions(worktreeId)
  const loadTestMap = useAppStore((state) => state.loadApiClientTestMap)
  const testMaps = useAppStore(
    useShallow((state) =>
      collections.map((c) => state.apiClientTestRunByTarget[testRunKey(worktreeId, c.id)]?.testMap)
    )
  )
  const uncleaned = useAppStore(
    useShallow((state) =>
      collections.map(
        (c) =>
          (state.apiClientTestRunByTarget[testRunKey(worktreeId, c.id)]?.run?.cleanup.notCleaned
            .length ?? 0) > 0
      )
    )
  )
  // Why: the test-run API is absent when the API Client is unavailable (SSH).
  const testMapAvailable = Boolean(window.api.testRun)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [moving, setMoving] = useState<{ collectionId: string; nodeId: string } | null>(null)
  const [deleting, setDeleting] = useState<TreeRow | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (renameRequestId) {
      setRenamingId(renameRequestId)
    }
  }, [renameRequestId])

  useEffect(() => {
    if (!testMapAvailable) {
      return
    }
    for (const collection of collections) {
      void loadTestMap(worktreeId, collection.id)
    }
  }, [collections, loadTestMap, testMapAvailable, worktreeId])

  const testMapByCollection = useMemo(
    () => new Map(collections.map((c, index) => [c.id, testMaps[index] ?? null])),
    [collections, testMaps]
  )
  const markersByCollection = useMemo(
    () => new Map([...testMapByCollection].map(([id, map]) => [id, buildRequestMarkers(map)])),
    [testMapByCollection]
  )

  const hasUncleanedFor = (collectionId: string): boolean =>
    uncleaned[collections.findIndex((c) => c.id === collectionId)] ?? false

  const menuStateFor = (collectionId: string): TestMapMenuState =>
    !testMapAvailable ? 'unavailable' : testMapByCollection.get(collectionId) ? 'loaded' : 'none'

  const rows = useMemo(
    () => buildTreeRows(collections, expanded, query),
    [collections, expanded, query]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12
  })

  const expand = (id: string): void => setExpanded((current) => new Set(current).add(id))

  const toggle = (row: TreeRow): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(row.id)) {
        next.add(row.id)
      }
      return next
    })

  const open = (row: TreeRow): void => {
    if (tabId && row.kind === 'request') {
      setView(tabId, { kind: 'request', requestId: row.id })
    }
  }

  const createChild = async (row: TreeRow, kind: 'request' | 'folder'): Promise<void> => {
    const parentId = row.kind === 'collection' ? null : row.id
    const id =
      kind === 'request'
        ? await actions.createRequest(row.collectionId, parentId)
        : await actions.createFolder(row.collectionId, parentId)
    if (!id) {
      return
    }
    expand(row.id)
    setRenamingId(id)
    if (kind === 'request' && tabId) {
      setView(tabId, { kind: 'request', requestId: id })
    }
  }

  const onAction = (row: TreeRow, action: RowAction): void => {
    switch (action) {
      case 'new-request':
      case 'new-folder':
        void createChild(row, action === 'new-request' ? 'request' : 'folder')
        break
      case 'rename':
        setRenamingId(row.id)
        break
      case 'duplicate':
        void actions.duplicate(row.collectionId, row.kind === 'collection' ? undefined : row.id)
        break
      case 'move':
        setMoving({ collectionId: row.collectionId, nodeId: row.id })
        break
      case 'delete':
        setDeleting(row)
        break
      case 'run':
        if (row.kind !== 'request' && tabId) {
          setView(tabId, {
            kind: 'runner',
            scope: {
              collectionId: row.collectionId,
              ...(row.kind === 'folder' ? { folderId: row.id } : {})
            }
          })
        }
        break
      // Why: the setup screen offers "Run cleanup only" for the stored ledger.
      case 'run-cleanup-only':
      case 'run-as-test':
        if (tabId) {
          setView(tabId, { kind: 'test-run', collectionId: row.collectionId })
        }
        break
      case 'export':
        onExportCollection?.(row.collectionId)
        break
      case 'load-test-map':
        void testMapActions.load(row.collectionId)
        break
      case 'export-test-map':
        void testMapActions.exportMap(row.collectionId)
        break
      case 'remove-test-map':
        testMapActions.askRemove(row.collectionId, row.name)
        break
    }
  }

  const commitRename = (row: TreeRow, name: string): void => {
    setRenamingId(null)
    const trimmed = name.trim()
    if (trimmed && trimmed !== row.name) {
      void actions.rename(row.collectionId, row.kind === 'collection' ? undefined : row.id, trimmed)
    }
  }

  const movingCollection = moving
    ? collections.find((c) => c.id === moving.collectionId)
    : undefined

  return (
    <>
      <div
        ref={scrollRef}
        role="tree"
        aria-label={translate('apiClient.tree.label', 'Collections')}
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            return (
              <div
                key={`${row.kind}:${row.id}`}
                className="absolute left-0 w-full"
                style={{ top: item.start, height: item.size }}
              >
                <CollectionTreeRow
                  row={row}
                  selected={row.kind === 'request' && row.id === selectedRequestId}
                  renaming={renamingId === row.id}
                  testMapState={menuStateFor(row.collectionId)}
                  hasUncleanedCaptures={hasUncleanedFor(row.collectionId)}
                  testMapMarker={
                    row.kind === 'request'
                      ? markersByCollection.get(row.collectionId)?.get(row.id)
                      : undefined
                  }
                  brokenLinkCount={
                    row.kind === 'collection'
                      ? countBrokenLinks(testMapByCollection.get(row.id) ?? null)
                      : 0
                  }
                  onToggle={toggle}
                  onOpen={open}
                  onAction={onAction}
                  onRenameCommit={commitRename}
                  onRenameCancel={() => setRenamingId(null)}
                />
              </div>
            )
          })}
        </div>
      </div>
      <TestMapDialogs
        state={testMapActions.state}
        onConfirmReplace={() => void testMapActions.confirmReplace()}
        onConfirmRemove={() => void testMapActions.confirmRemove()}
        onClose={testMapActions.close}
      />
      {deleting ? (
        <ConfirmDeleteDialog
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting
            setDeleting(null)
            void actions.remove(
              target.collectionId,
              target.kind === 'collection' ? undefined : target.id
            )
          }}
        />
      ) : null}
      {moving && movingCollection ? (
        <MoveToDialog
          collection={movingCollection}
          nodeId={moving.nodeId}
          onCancel={() => setMoving(null)}
          onMove={(parentId) => {
            const target = moving
            setMoving(null)
            void actions.move(target.collectionId, target.nodeId, parentId)
          }}
        />
      ) : null}
    </>
  )
}
