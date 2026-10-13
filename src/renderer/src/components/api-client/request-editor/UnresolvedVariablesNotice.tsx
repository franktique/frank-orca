import { translate } from '@/i18n/i18n'
import {
  findUnresolvedVariables,
  type VariableScope
} from '../../../../../shared/api-client/variable-resolution'

type UnresolvedVariablesNoticeProps = {
  texts: readonly string[]
  scopes: readonly VariableScope[]
}

export default function UnresolvedVariablesNotice({
  texts,
  scopes
}: UnresolvedVariablesNoticeProps): React.JSX.Element | null {
  const names = [
    ...new Set(texts.flatMap((text) => findUnresolvedVariables(text, scopes).map((s) => s.name)))
  ]
  if (names.length === 0) {
    return null
  }
  return (
    <p className="text-xs text-destructive" role="status">
      {translate('apiClient.table.unresolved', 'Unresolved: {{names}}', {
        names: names.map((name) => `{{${name}}}`).join(', ')
      })}
    </p>
  )
}
