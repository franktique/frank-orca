import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { KeyValue } from '../../../../../shared/api-client/api-client-types'
import {
  findUnresolvedVariables,
  type VariableScope
} from '../../../../../shared/api-client/variable-resolution'
import { useStableRowIds } from './use-stable-row-ids'

type KeyValueTableProps = {
  rows: readonly KeyValue[]
  onChange: (rows: KeyValue[]) => void
  scopes: readonly VariableScope[]
  /** Accessible name of the whole table. */
  label: string
  showDescription?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
}

const emptyRow = (): KeyValue => ({ key: '', value: '', enabled: true })

function unresolvedNames(text: string, scopes: readonly VariableScope[]): string[] {
  return [...new Set(findUnresolvedVariables(text, scopes).map((span) => span.name))]
}

/** Params, headers and form bodies. The trailing blank row is where new entries start. */
export default function KeyValueTable({
  rows,
  onChange,
  scopes,
  label,
  showDescription = false,
  keyPlaceholder,
  valuePlaceholder
}: KeyValueTableProps): React.JSX.Element {
  // One id beyond the rows belongs to the blank row, so typing in it keeps the same input mounted
  // when it turns into a real row.
  const { ids, removeAt } = useStableRowIds(rows.length + 1)

  const update = (index: number, patch: Partial<KeyValue>): void =>
    onChange(
      index === rows.length
        ? [...rows, { ...emptyRow(), ...patch }]
        : rows.map((row, position) => (position === index ? { ...row, ...patch } : row))
    )

  const remove = (index: number): void => {
    removeAt(index)
    onChange(rows.filter((_, position) => position !== index))
  }

  const renderRow = (row: KeyValue, index: number, rowId: string): React.JSX.Element => {
    const missing = unresolvedNames(`${row.key} ${row.value}`, scopes)
    const isDraftRow = index === rows.length
    return (
      <tr key={rowId} className="border-b border-border">
        <td className="w-8 px-2 py-1 text-center">
          {isDraftRow ? null : (
            <Checkbox
              checked={row.enabled}
              aria-label={translate('apiClient.table.enabled', 'Enabled')}
              onCheckedChange={(checked) => update(index, { enabled: checked === true })}
            />
          )}
        </td>
        <td className="px-1 py-1">
          <Input
            value={row.key}
            placeholder={keyPlaceholder ?? translate('apiClient.table.key', 'Key')}
            aria-label={translate('apiClient.table.key', 'Key')}
            className="h-8"
            onChange={(event) => update(index, { key: event.target.value })}
          />
        </td>
        <td className="px-1 py-1">
          <Input
            value={row.value}
            placeholder={valuePlaceholder ?? translate('apiClient.table.value', 'Value')}
            aria-label={translate('apiClient.table.value', 'Value')}
            aria-invalid={missing.length > 0}
            title={
              missing.length > 0
                ? translate('apiClient.table.unresolved', 'Unresolved: {{names}}', {
                    names: missing.map((name) => `{{${name}}}`).join(', ')
                  })
                : undefined
            }
            className="h-8"
            onChange={(event) => update(index, { value: event.target.value })}
          />
        </td>
        {showDescription ? (
          <td className="px-1 py-1">
            <Input
              value={row.description ?? ''}
              placeholder={translate('apiClient.table.description', 'Description')}
              aria-label={translate('apiClient.table.description', 'Description')}
              className="h-8"
              onChange={(event) => update(index, { description: event.target.value })}
            />
          </td>
        ) : null}
        <td className="w-8 px-1 py-1 text-center">
          {isDraftRow ? null : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate('apiClient.table.deleteRow', 'Delete row')}
              onClick={() => remove(index)}
            >
              <Trash2 />
            </Button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <table className="w-full table-fixed border-collapse text-left" aria-label={label}>
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="w-8 px-2 py-1" scope="col">
            <span className="sr-only">{translate('apiClient.table.enabled', 'Enabled')}</span>
          </th>
          <th className="px-2 py-1 font-semibold" scope="col">
            {translate('apiClient.table.key', 'Key')}
          </th>
          <th className="px-2 py-1 font-semibold" scope="col">
            {translate('apiClient.table.value', 'Value')}
          </th>
          {showDescription ? (
            <th className="px-2 py-1 font-semibold" scope="col">
              {translate('apiClient.table.description', 'Description')}
            </th>
          ) : null}
          <th className="w-8 px-1 py-1" scope="col">
            <span className="sr-only">{translate('apiClient.table.deleteRow', 'Delete row')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => renderRow(row, index, ids[index]))}
        {renderRow(emptyRow(), rows.length, ids[rows.length])}
      </tbody>
    </table>
  )
}
