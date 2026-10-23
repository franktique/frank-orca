import { lazy, Suspense } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { VariableScope } from '../../../../../shared/api-client/variable-resolution'
import type { VerificationQuery } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import UnresolvedVariablesNotice from '../request-editor/UnresolvedVariablesNotice'

const ApiClientCodeEditor = lazy(() => import('../ApiClientCodeEditor'))

type VerificationQueryEditorProps = {
  query: VerificationQuery
  index: number
  count: number
  scopes: readonly VariableScope[]
  onChange: (query: VerificationQuery) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

export default function VerificationQueryEditor({
  query,
  index,
  count,
  scopes,
  onChange,
  onMove,
  onRemove
}: VerificationQueryEditorProps): React.JSX.Element {
  const label = translate('apiClient.verification.queryLabel', 'Query {{number}}', {
    number: index + 1
  })
  return (
    <div className="space-y-2 rounded-md border border-border p-2" data-verification-query>
      <div className="flex items-center gap-2">
        <Input
          value={query.description ?? ''}
          placeholder={translate(
            'apiClient.verification.descriptionPlaceholder',
            'What does this query check?'
          )}
          aria-label={translate('apiClient.verification.description', 'Description')}
          onChange={(event) => onChange({ ...query, description: event.target.value || undefined })}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={index === 0}
          aria-label={translate('apiClient.verification.moveUp', 'Move up')}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={index === count - 1}
          aria-label={translate('apiClient.verification.moveDown', 'Move down')}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('apiClient.verification.remove', 'Remove query')}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="h-28">
        <Suspense fallback={null}>
          <ApiClientCodeEditor
            label={label}
            language="pgsql"
            value={query.sql}
            onChange={(sql) => onChange({ ...query, sql })}
          />
        </Suspense>
      </div>
      <UnresolvedVariablesNotice texts={[query.sql]} scopes={scopes} />
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${query.id}-precondition`}
            checked={query.precondition}
            onCheckedChange={(checked) => onChange({ ...query, precondition: checked === true })}
          />
          <Label htmlFor={`${query.id}-precondition`}>
            {translate('apiClient.verification.precondition', 'Precondition')}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${query.id}-changes-data`}
            checked={query.changesData}
            onCheckedChange={(checked) => onChange({ ...query, changesData: checked === true })}
          />
          <Label htmlFor={`${query.id}-changes-data`}>
            {translate('apiClient.verification.changesData', 'Changes data')}
          </Label>
        </div>
      </div>
    </div>
  )
}
