import { useState } from 'react'
import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { VariableType } from '../../../../../shared/api-client/api-client-types'
import type { EditableEnvironmentVariable } from '@/store/slices/api-client-environment-draft'
import { useStableRowIds } from '../request-editor/use-stable-row-ids'

const MASK_PLACEHOLDER = '••••••••'

type VariablesTableProps = {
  variables: readonly EditableEnvironmentVariable[]
  onChange: (variables: EditableEnvironmentVariable[]) => void
  onReveal: (index: number) => void
}

const blankVariable = (): EditableEnvironmentVariable => ({
  key: '',
  value: '',
  enabled: true,
  type: 'default',
  masked: false,
  needsReentry: false,
  revealedValue: null
})

function SecretValueCell({
  variable,
  onValueChange,
  onReveal
}: {
  variable: EditableEnvironmentVariable
  onValueChange: (value: string) => void
  onReveal: () => void
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex items-center gap-1">
      <Input
        type={visible ? 'text' : 'password'}
        value={variable.masked ? '' : variable.value}
        placeholder={
          variable.masked
            ? MASK_PLACEHOLDER
            : variable.needsReentry
              ? translate('apiClient.environments.reenter', 'Re-enter value')
              : translate('apiClient.table.value', 'Value')
        }
        aria-label={translate('apiClient.table.value', 'Value')}
        className="h-8"
        onChange={(event) => onValueChange(event.target.value)}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={
          variable.masked || !visible
            ? translate('apiClient.environments.reveal', 'Reveal value')
            : translate('apiClient.environments.hide', 'Hide value')
        }
        onClick={() => {
          if (variable.masked) {
            onReveal()
            setVisible(true)
          } else {
            setVisible((current) => !current)
          }
        }}
      >
        {visible && !variable.masked ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  )
}

/**
 * The scrolling variable table (FR-008). The table itself is the scroll container and its header is
 * sticky, so the name, Save and column titles stay in view however long the list is.
 */
export default function VariablesTable({
  variables,
  onChange,
  onReveal
}: VariablesTableProps): React.JSX.Element {
  // One id beyond the rows belongs to the blank row, which turns into a real one while typing.
  const { ids, removeAt } = useStableRowIds(variables.length + 1)

  const update = (index: number, patch: Partial<EditableEnvironmentVariable>): void =>
    onChange(
      index === variables.length
        ? [...variables, { ...blankVariable(), ...patch }]
        : variables.map((row, position) => (position === index ? { ...row, ...patch } : row))
    )

  const renderRow = (
    variable: EditableEnvironmentVariable,
    index: number,
    rowId: string
  ): React.JSX.Element => {
    const isBlankRow = index === variables.length
    return (
      <tr key={rowId} className="border-b border-border">
        <td className="w-8 px-2 py-1 text-center">
          {isBlankRow ? null : (
            <Checkbox
              checked={variable.enabled}
              aria-label={translate('apiClient.table.enabled', 'Enabled')}
              onCheckedChange={(checked) => update(index, { enabled: checked === true })}
            />
          )}
        </td>
        <td className="px-1 py-1">
          <Input
            value={variable.key}
            placeholder={translate('apiClient.environments.name', 'Variable name')}
            aria-label={translate('apiClient.environments.name', 'Variable name')}
            className="h-8"
            onChange={(event) => update(index, { key: event.target.value })}
          />
        </td>
        <td className="px-1 py-1">
          {variable.type === 'secret' ? (
            <SecretValueCell
              variable={variable}
              onValueChange={(value) => update(index, { value, masked: false })}
              onReveal={() => onReveal(index)}
            />
          ) : (
            <Input
              value={variable.value}
              placeholder={translate('apiClient.table.value', 'Value')}
              aria-label={translate('apiClient.table.value', 'Value')}
              className="h-8"
              onChange={(event) => update(index, { value: event.target.value })}
            />
          )}
        </td>
        <td className="w-32 px-1 py-1">
          <Select
            value={variable.type}
            // A masked secret has no value here to carry into a plain variable.
            disabled={variable.masked}
            onValueChange={(type) => {
              const next: VariableType = type === 'secret' ? 'secret' : 'default'
              update(index, { type: next })
            }}
          >
            <SelectTrigger
              className="h-8 w-full"
              aria-label={translate('apiClient.environments.type', 'Type')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                {translate('apiClient.environments.default', 'Default')}
              </SelectItem>
              <SelectItem value="secret">
                {translate('apiClient.environments.secret', 'Secret')}
              </SelectItem>
            </SelectContent>
          </Select>
        </td>
        <td className="w-8 px-1 py-1 text-center">
          {isBlankRow ? null : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate('apiClient.table.deleteRow', 'Delete row')}
              onClick={() => {
                removeAt(index)
                onChange(variables.filter((_, position) => position !== index))
              }}
            >
              <Trash2 />
            </Button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto" data-testid="variables-scroll">
      <table
        className="w-full table-fixed border-collapse text-left"
        aria-label={translate('apiClient.environments.variables', 'Variables')}
      >
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="w-8 px-2 py-1" scope="col">
              <span className="sr-only">{translate('apiClient.table.enabled', 'Enabled')}</span>
            </th>
            <th className="px-2 py-1 font-semibold" scope="col">
              {translate('apiClient.environments.name', 'Variable name')}
            </th>
            <th className="px-2 py-1 font-semibold" scope="col">
              {translate('apiClient.table.value', 'Value')}
            </th>
            <th className="w-32 px-2 py-1 font-semibold" scope="col">
              {translate('apiClient.environments.type', 'Type')}
            </th>
            <th className="w-8 px-1 py-1" scope="col">
              <span className="sr-only">
                {translate('apiClient.table.deleteRow', 'Delete row')}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {variables.map((variable, index) => renderRow(variable, index, ids[index]))}
          {renderRow(blankVariable(), variables.length, ids[variables.length])}
        </tbody>
      </table>
    </div>
  )
}
