import { Loader2, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  findUnresolvedVariables,
  type VariableScope
} from '../../../../../shared/api-client/variable-resolution'

const STANDARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

type UrlBarProps = {
  method: string
  url: string
  scopes: readonly VariableScope[]
  sending: boolean
  onMethodChange: (method: string) => void
  onUrlChange: (url: string) => void
  onSend: () => void
  onCancel: () => void
}

export default function UrlBar({
  method,
  url,
  scopes,
  sending,
  onMethodChange,
  onUrlChange,
  onSend,
  onCancel
}: UrlBarProps): React.JSX.Element {
  const unresolved = [...new Set(findUnresolvedVariables(url, scopes).map((span) => span.name))]
  // A custom verb imported from Postman must stay selectable.
  const methods = STANDARD_METHODS.some((known) => known === method)
    ? STANDARD_METHODS
    : [...STANDARD_METHODS, method]

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Select value={method} onValueChange={onMethodChange}>
          <SelectTrigger
            className="w-28"
            aria-label={translate('apiClient.request.method', 'Method')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {methods.map((verb) => (
              <SelectItem key={verb} value={verb}>
                {verb}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={url}
          placeholder={translate('apiClient.request.urlPlaceholder', 'https://example.com/path')}
          aria-label={translate('apiClient.request.url', 'Request URL')}
          aria-invalid={unresolved.length > 0}
          className="flex-1"
          onChange={(event) => onUrlChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !sending) {
              onSend()
            }
          }}
        />
        {sending ? (
          <Button variant="outline" onClick={onCancel}>
            <Square />
            {translate('apiClient.request.cancel', 'Cancel')}
          </Button>
        ) : (
          <Button onClick={onSend}>
            <Send />
            {translate('apiClient.request.send', 'Send')}
          </Button>
        )}
      </div>
      {unresolved.length > 0 ? (
        <p className="text-xs text-destructive" role="status">
          {translate('apiClient.table.unresolved', 'Unresolved: {{names}}', {
            names: unresolved.map((name) => `{{${name}}}`).join(', ')
          })}
        </p>
      ) : null}
      {sending ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {translate('apiClient.request.sending', 'Sending…')}
        </p>
      ) : null}
    </div>
  )
}
