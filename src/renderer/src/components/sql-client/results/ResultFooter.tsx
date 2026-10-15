import { translate } from '@/i18n/i18n'

export default function ResultFooter({
  count,
  countLabel,
  elapsedMs,
  rowCapApplied = false,
  sizeLimitReached = false
}: {
  count: number
  countLabel: 'rows' | 'affected'
  elapsedMs: number
  rowCapApplied?: boolean
  sizeLimitReached?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1 text-xs text-muted-foreground">
      <span>
        {countLabel === 'rows'
          ? translate('sqlClient.footer.rows', '{{count}} rows', { count })
          : translate('sqlClient.footer.affected', '{{count}} rows affected', { count })}
      </span>
      <span>{translate('sqlClient.footer.elapsed', '{{ms}} ms', { ms: elapsedMs })}</span>
      {rowCapApplied ? (
        <span>
          {translate('sqlClient.footer.rowCap', 'Limited to 1000 rows — add LIMIT to change')}
        </span>
      ) : null}
      {sizeLimitReached ? (
        <span>
          {translate(
            'sqlClient.footer.sizeLimit',
            'Size limit (50 MB) reached; showing rows loaded so far'
          )}
        </span>
      ) : null}
    </div>
  )
}
