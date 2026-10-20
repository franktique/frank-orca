import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { ExplanationChangeLegend } from './explanation-change-legend'
import { ExplanationFileList } from './explanation-file-list'
import {
  buildExplanationPanelModel,
  filterExplanationRowsByChange
} from './explanation-panel-model'
import { useOpenExplanationDiff } from './use-open-explanation-diff'

export default function ExplanationsPanel(): React.JSX.Element {
  const workspaceId = useAppStore((s) => s.activeWorktreeId)
  const state = useAppStore((s) =>
    s.activeWorktreeId ? s.explanationsByWorkspace[s.activeWorktreeId] : undefined
  )
  const activeFilePath = useAppStore((s) => {
    const id = s.activeWorktreeId ? s.activeFileIdByWorktree?.[s.activeWorktreeId] : null
    return s.openFiles?.find((file) => file.id === id)?.relativePath ?? null
  })
  const loadChangeSet = useAppStore((s) => s.loadExplanationChangeSet)
  const setFocusedChange = useAppStore((s) => s.setFocusedExplanationChange)
  const clearExplanation = useAppStore((s) => s.clearExplanation)
  const confirm = useConfirmationDialog()
  const openExplanationDiff = useOpenExplanationDiff(workspaceId)
  const explanation = state?.explanation ?? null
  const changeSet = state?.changeSet
  const revision = explanation?.revision

  // Why: a republish swaps the whole set under an open panel; say so briefly instead of silently.
  const [replacedNotice, setReplacedNotice] = useState(false)
  const previousIdRef = useRef<string | null>(explanation?.id ?? null)
  const explanationId = explanation?.id ?? null
  useEffect(() => {
    const previous = previousIdRef.current
    previousIdRef.current = explanationId
    if (previous === null || explanationId === null || previous === explanationId) {
      return
    }
    setReplacedNotice(true)
    const timer = window.setTimeout(() => setReplacedNotice(false), 6000)
    return () => window.clearTimeout(timer)
  }, [explanationId])

  // Why: the live change set decides Unexplained / no-longer-changed rows, so it is re-read on
  // open and on every republish; a failed read flips it to "unavailable" instead of empty.
  useEffect(() => {
    if (workspaceId && revision !== undefined) {
      void loadChangeSet(workspaceId)
    }
  }, [loadChangeSet, revision, workspaceId])

  const model = useMemo(
    () => (explanation && changeSet ? buildExplanationPanelModel(explanation, changeSet) : null),
    [explanation, changeSet]
  )

  if (!workspaceId || !explanation || !model) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.explanations.empty',
          'No explanation for this workspace.'
        )}
      </div>
    )
  }

  const focused = state?.focusedChangeIndex ?? null
  const explainedRows =
    focused === null ? model.explained : filterExplanationRowsByChange(explanation, model, focused)
  const base = explanation.changeSetBase
  const baseLabel =
    base.kind === 'branch-and-uncommitted' && base.baseRef
      ? base.baseRef
      : translate(
          'auto.components.right.sidebar.explanations.base.uncommittedOnly',
          'uncommitted changes only'
        )

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="explanations-panel">
      <div className="flex flex-col gap-0.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {translate(
              'auto.components.right.sidebar.explanations.header.agent',
              'Explained by {{agent}}',
              { agent: explanation.producer.agentName }
            )}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid="explanations-clear"
            aria-label={translate(
              'auto.components.right.sidebar.explanations.clear.action',
              'Clear explanation'
            )}
            onClick={async () => {
              const confirmed = await confirm({
                title: translate(
                  'auto.components.right.sidebar.explanations.clear.title',
                  'Clear this explanation?'
                ),
                description: translate(
                  'auto.components.right.sidebar.explanations.clear.description',
                  'The explanation and any questions you asked about it are removed. Review notes are kept.'
                ),
                confirmLabel: translate(
                  'auto.components.right.sidebar.explanations.clear.confirm',
                  'Clear'
                ),
                confirmVariant: 'destructive'
              })
              if (confirmed) {
                void clearExplanation(workspaceId)
              }
            }}
          >
            <Trash2 />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(explanation.generatedAt)} · {baseLabel}
        </span>
        {explanation.publishWarnings.length > 0 ? (
          <span className="text-xs text-muted-foreground" data-testid="explanations-warnings">
            {translate(
              'auto.components.right.sidebar.explanations.header.adjusted',
              '{{total}} anchors were adjusted',
              { total: explanation.publishWarnings.length }
            )}
          </span>
        ) : null}
        {replacedNotice ? (
          <span className="text-xs text-muted-foreground" data-testid="explanations-replaced">
            {translate(
              'auto.components.right.sidebar.explanations.header.replaced',
              'Replaced by a newer explanation'
            )}
          </span>
        ) : null}
        {model.changeSetUnavailable ? (
          <span className="pt-1 text-xs text-muted-foreground" data-testid="explanations-offline">
            {translate(
              'auto.components.right.sidebar.explanations.header.disconnected',
              'Host disconnected — showing the last saved explanation'
            )}
          </span>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="pt-2">
          <ExplanationChangeLegend
            changes={explanation.changes}
            focusedChangeIndex={focused}
            onFocusChange={(changeIndex) => setFocusedChange(workspaceId, changeIndex)}
          />
          <ExplanationFileList
            explained={explainedRows}
            unexplained={focused === null ? model.unexplained : []}
            activePath={activeFilePath}
            onOpenFile={(row) => openExplanationDiff({ path: row.path, oldPath: row.oldPath })}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
