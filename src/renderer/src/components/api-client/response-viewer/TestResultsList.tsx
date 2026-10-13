import { Check, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { TestResult } from '../../../../../shared/api-client/api-client-types'

export default function TestResultsList({
  tests
}: {
  tests: readonly TestResult[]
}): React.JSX.Element {
  if (tests.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('apiClient.response.noTests', 'This request has no tests.')}
      </p>
    )
  }
  return (
    <ul className="space-y-1" aria-label={translate('apiClient.response.tests', 'Tests')}>
      {tests.map((test, index) => (
        <li
          // Test names may repeat within one script.
          key={`${test.name}:${tests.slice(0, index).filter((t) => t.name === test.name).length}`}
          className="flex items-start gap-2 text-xs"
          data-passed={test.passed}
        >
          {test.passed ? (
            <Check
              className="mt-0.5 size-3.5 shrink-0"
              aria-label={translate('apiClient.response.passed', 'Passed')}
            />
          ) : (
            <X
              className="mt-0.5 size-3.5 shrink-0 text-destructive"
              aria-label={translate('apiClient.response.failed', 'Failed')}
            />
          )}
          <div className="min-w-0">
            <div className="break-words">{test.name}</div>
            {test.error ? <div className="break-words text-destructive">{test.error}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
