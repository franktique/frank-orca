import { lazy, Suspense } from 'react'
import { translate } from '@/i18n/i18n'
import type { Script, ScriptEvents } from '../../../../../shared/api-client/api-client-types'

const ApiClientCodeEditor = lazy(() => import('../ApiClientCodeEditor'))

type ScriptsEditorProps = {
  events: ScriptEvents
  onChange: (events: ScriptEvents) => void
}

function setScript(
  events: ScriptEvents,
  phase: 'prerequest' | 'test',
  source: string
): ScriptEvents {
  const existing: Script | undefined = events[phase]
  const lines = source.split('\n')
  const next: ScriptEvents = { ...events }
  if (source === '' && !existing) {
    return next
  }
  next[phase] = { ...existing, exec: lines }
  return next
}

/** Pre-request and test scripts, stored as Postman's line array and edited as plain text. */
export default function ScriptsEditor({ events, onChange }: ScriptsEditorProps): React.JSX.Element {
  return (
    <div className="grid h-full min-h-0 grid-rows-2 gap-3">
      {(['prerequest', 'test'] as const).map((phase) => (
        <section key={phase} className="flex min-h-0 flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {phase === 'prerequest'
              ? translate('apiClient.scripts.prerequest', 'Pre-request script')
              : translate('apiClient.scripts.test', 'Test script')}
          </h4>
          <div className="min-h-0 flex-1">
            <Suspense fallback={null}>
              <ApiClientCodeEditor
                label={
                  phase === 'prerequest'
                    ? translate('apiClient.scripts.prerequest', 'Pre-request script')
                    : translate('apiClient.scripts.test', 'Test script')
                }
                language="javascript"
                value={events[phase]?.exec.join('\n') ?? ''}
                onChange={(source) => onChange(setScript(events, phase, source))}
              />
            </Suspense>
          </div>
        </section>
      ))}
    </div>
  )
}
