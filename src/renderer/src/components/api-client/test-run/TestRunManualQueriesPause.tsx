import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type {
  PauseAnswer,
  PauseQuery
} from '../../../../../shared/test-orchestrator/test-orchestrator-types'

type TestRunManualQueriesPauseProps = {
  queries: PauseQuery[]
  onAnswer: (answer: PauseAnswer) => void
}

export default function TestRunManualQueriesPause({
  queries,
  onAnswer
}: TestRunManualQueriesPauseProps): React.JSX.Element {
  const [pasted, setPasted] = useState<Record<string, string>>({})
  const [skipped, setSkipped] = useState<string[]>([])

  const pastedForContinue = Object.fromEntries(
    Object.entries(pasted).filter(
      ([queryId, text]) => text.trim() !== '' && !skipped.includes(queryId)
    )
  )

  return (
    <div className="space-y-3">
      {queries.map((query) => {
        const isSkipped = skipped.includes(query.queryId)
        return (
          <div key={query.queryId} className="space-y-1">
            {query.description ? (
              <p className="text-xs text-muted-foreground">{query.description}</p>
            ) : null}
            <pre className="scrollbar-sleek overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
              {query.sqlResolved}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void window.api.ui.writeClipboardText(query.sqlRaw ?? query.sqlResolved)
                }
              >
                <Copy />
                {translate('apiClient.testRun.pause.copy', 'Copy')}
              </Button>
              <Button
                size="sm"
                variant={isSkipped ? 'secondary' : 'outline'}
                aria-pressed={isSkipped}
                onClick={() =>
                  setSkipped((current) =>
                    isSkipped
                      ? current.filter((id) => id !== query.queryId)
                      : [...current, query.queryId]
                  )
                }
              >
                {translate('apiClient.testRun.pause.skip', 'Skip')}
              </Button>
            </div>
            {isSkipped ? null : (
              <Textarea
                aria-label={translate(
                  'apiClient.testRun.pause.pasteResult',
                  'Paste result (optional)'
                )}
                placeholder={translate(
                  'apiClient.testRun.pause.pasteResult',
                  'Paste result (optional)'
                )}
                value={pasted[query.queryId] ?? ''}
                onChange={(event) =>
                  setPasted((current) => ({ ...current, [query.queryId]: event.target.value }))
                }
              />
            )}
          </div>
        )
      })}
      <Button
        size="sm"
        onClick={() => {
          // Why: the contract has no mixed answer, so skips win and pasted text is dropped.
          if (skipped.length > 0) {
            onAnswer({ kind: 'manual-queries', action: 'skip', queryIds: skipped })
            return
          }
          onAnswer({ kind: 'manual-queries', action: 'continue', pasted: pastedForContinue })
        }}
      >
        {translate('apiClient.testRun.pause.continue', 'Continue')}
      </Button>
    </div>
  )
}
