import React from 'react'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { basename, dirname } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { STATUS_COLORS, STATUS_LABELS } from '../status-display'
import type { ExplanationPanelRow } from './explanation-panel-model'

type ExplanationFileListProps = {
  explained: readonly ExplanationPanelRow[]
  unexplained: readonly ExplanationPanelRow[]
  activePath: string | null
  onOpenFile: (row: ExplanationPanelRow) => void
}

function ExplanationFileRow({
  row,
  active,
  onOpen
}: {
  row: ExplanationPanelRow
  active: boolean
  onOpen: (row: ExplanationPanelRow) => void
}): React.JSX.Element {
  const parentDir = dirname(row.path)
  return (
    <button
      type="button"
      data-testid="explanation-file-row"
      data-explanation-path={row.path}
      data-current={active ? 'true' : undefined}
      className="group flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-left transition-colors hover:bg-accent/40 data-[current=true]:bg-accent"
      onClick={() => onOpen(row)}
    >
      {React.createElement(getFileTypeIcon(row.path), {
        className: 'size-3.5 shrink-0 text-muted-foreground'
      })}
      <span className="min-w-0 flex-1 truncate text-[13px]">
        <span className={row.noLongerChanged ? 'text-muted-foreground line-through' : undefined}>
          {basename(row.path)}
        </span>
        {parentDir !== '.' ? (
          <span className="ml-1.5 text-xs text-muted-foreground">{parentDir}</span>
        ) : null}
      </span>
      {row.noLongerChanged ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.explanations.file.noLongerChanged',
            'unchanged'
          )}
        </span>
      ) : null}
      {row.labels.map((label) => (
        <span
          key={label}
          data-testid="explanation-file-label"
          className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-semibold text-foreground"
        >
          {label}
        </span>
      ))}
      <span
        className="w-3 shrink-0 text-center text-[11px] font-semibold"
        style={{ color: STATUS_COLORS[row.status] }}
      >
        {STATUS_LABELS[row.status]}
      </span>
    </button>
  )
}

export function ExplanationFileList({
  explained,
  unexplained,
  activePath,
  onOpenFile
}: ExplanationFileListProps): React.JSX.Element {
  return (
    <div className="flex flex-col pb-2">
      {explained.map((row) => (
        <ExplanationFileRow
          key={row.path}
          row={row}
          active={row.path === activePath}
          onOpen={onOpenFile}
        />
      ))}
      {unexplained.length > 0 ? (
        <>
          <div
            data-testid="explanation-unexplained-header"
            className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {translate('auto.components.right.sidebar.explanations.unexplained', 'Unexplained')}
          </div>
          {unexplained.map((row) => (
            <ExplanationFileRow
              key={row.path}
              row={row}
              active={row.path === activePath}
              onOpen={onOpenFile}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}
