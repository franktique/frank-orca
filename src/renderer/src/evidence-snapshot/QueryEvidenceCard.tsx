import { translate } from '@/i18n/i18n'
import SqlResultsGrid from '@/components/sql-client/results/SqlResultsGrid'
import type { SqlColumn } from '../../../shared/sql-client/sql-client-types'
import type { QueryEvidenceCardData } from '../../../shared/test-orchestrator/evidence-snapshot-card'

// Why: a screenshot cannot scroll, so the grid is cut to what fits (rows stay in report.md).
const GRID_MAX_HEIGHT = 480

function toColumns(names: readonly string[]): SqlColumn[] {
  return names.map((name) => ({ name, dataTypeId: 0, dataTypeName: '' }))
}

export default function QueryEvidenceCard({
  card
}: {
  card: QueryEvidenceCardData
}): React.JSX.Element {
  const { result } = card
  return (
    <article
      className="flex flex-col gap-3 bg-background p-4 text-foreground"
      data-testid="query-evidence-card"
    >
      <h2 className="text-sm font-semibold">{card.title}</h2>
      {card.description ? (
        <p className="text-xs text-muted-foreground">{card.description}</p>
      ) : null}
      <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-2 font-mono text-xs">
        {card.sql}
      </pre>
      {card.error ? (
        <p className="text-sm text-destructive" role="alert">
          {card.error}
        </p>
      ) : null}
      {result ? (
        <>
          <SqlResultsGrid
            columns={toColumns(result.columns)}
            rows={result.rows}
            staticMaxHeight={GRID_MAX_HEIGHT}
          />
          <p className="text-xs text-muted-foreground">
            {result.truncated
              ? translate('evidenceSnapshot.rowsTruncated', 'Showing {{shown}} of {{total}} rows', {
                  shown: result.rows.length,
                  total: result.totalRows
                })
              : translate('evidenceSnapshot.rowCount', '{{count}} rows', {
                  count: result.totalRows
                })}
          </p>
        </>
      ) : null}
    </article>
  )
}
