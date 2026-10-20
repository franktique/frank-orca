import React, { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { ExplanationDetachedList } from './explanation-detached-list'
import { listExplanationFileItemsUnresolved } from './explanation-file-items'

/** The diff could not be read (host unreachable): the saved explanation stays readable as cards. */
export function ExplanationUnreadableFile({
  worktreeId,
  relativePath,
  showDisconnectedNotice = true,
  children
}: {
  worktreeId: string
  relativePath: string
  showDisconnectedNotice?: boolean
  /** Rendered below the cards, e.g. the binary-file message. */
  children?: React.ReactNode
}): React.JSX.Element {
  const explanation = useAppStore((s) => s.explanationsByWorkspace[worktreeId]?.explanation ?? null)
  const items = useMemo(
    () => (explanation ? listExplanationFileItemsUnresolved(explanation, relativePath) : []),
    [explanation, relativePath]
  )
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col overflow-y-auto">
      <ExplanationDetachedList
        items={items}
        notice={
          showDisconnectedNotice
            ? translate(
                'auto.components.right.sidebar.explanations.header.disconnected',
                'Host disconnected — showing the last saved explanation'
              )
            : undefined
        }
      />
      {children}
    </div>
  )
}
