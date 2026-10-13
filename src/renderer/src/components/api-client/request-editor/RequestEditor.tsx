import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { ApiRequest } from '../../../../../shared/api-client/api-client-types'
import { applyQueryRows, applyRawUrl } from '../../../../../shared/api-client/url-query-sync'
import AuthEditor from './AuthEditor'
import BodyEditor from './BodyEditor'
import KeyValueTable from './KeyValueTable'
import RequestSettings from './RequestSettings'
import ScriptsEditor from './ScriptsEditor'
import UrlBar from './UrlBar'
import { useRequestVariableScopes } from './use-variable-scopes'
import { RequestDraftNotices } from './RequestDraftNotices'

const isMac = navigator.userAgent.includes('Mac')

type RequestEditorProps = {
  tabId: string
  worktreeId: string
  request: ApiRequest
}

/** Edits a draft copy of one request; Save writes it back, and nothing is lost on a tab switch. */
export default function RequestEditor({
  tabId,
  worktreeId,
  request
}: RequestEditorProps): React.JSX.Element {
  const draft = useAppStore((state) => state.apiClientDraftsByTab[tabId])
  const execution = useAppStore((state) => state.apiClientExecutionsByTab[tabId])
  const edit = useAppStore((state) => state.editApiClientRequest)
  const save = useAppStore((state) => state.saveApiClientDraft)
  const send = useAppStore((state) => state.sendApiClientRequest)
  const cancel = useAppStore((state) => state.cancelApiClientExecution)
  const scopes = useRequestVariableScopes(worktreeId, request.id)
  const requestDraft = draft?.kind === 'request' ? draft : undefined
  const current = requestDraft?.request ?? request
  const update = (patch: Partial<ApiRequest>): void => edit(tabId, { ...current, ...patch })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = isMac ? event.metaKey : event.ctrlKey
      if (
        modifier &&
        event.key.toLowerCase() === 's' &&
        useAppStore.getState().apiClientDraftsByTab[tabId]
      ) {
        event.preventDefault()
        void save(tabId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, tabId])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <RequestDraftNotices tabId={tabId} />
      <UrlBar
        method={current.method}
        url={current.url.raw}
        scopes={scopes}
        sending={Boolean(execution)}
        onMethodChange={(method) => update({ method })}
        onUrlChange={(raw) => update({ url: applyRawUrl(current.url, raw) })}
        onSend={() => void send(tabId)}
        onCancel={() => void cancel(tabId)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{current.name}</span>
        <Button size="sm" variant="secondary" disabled={!draft} onClick={() => void save(tabId)}>
          {translate('apiClient.request.save', 'Save')}
        </Button>
      </div>
      <Tabs defaultValue="params" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="params">
            {translate('apiClient.request.params', 'Params')}
          </TabsTrigger>
          <TabsTrigger value="headers">
            {translate('apiClient.request.headers', 'Headers')}
          </TabsTrigger>
          <TabsTrigger value="body">{translate('apiClient.request.body', 'Body')}</TabsTrigger>
          <TabsTrigger value="auth">{translate('apiClient.request.auth', 'Auth')}</TabsTrigger>
          <TabsTrigger value="scripts">
            {translate('apiClient.request.scripts', 'Scripts')}
          </TabsTrigger>
          <TabsTrigger value="settings">
            {translate('apiClient.request.settings', 'Settings')}
          </TabsTrigger>
        </TabsList>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pt-3">
          <TabsContent value="params">
            <KeyValueTable
              label={translate('apiClient.request.params', 'Params')}
              rows={current.url.query}
              scopes={scopes}
              showDescription
              onChange={(rows) => update({ url: applyQueryRows(current.url, rows) })}
            />
          </TabsContent>
          <TabsContent value="headers">
            <KeyValueTable
              label={translate('apiClient.request.headers', 'Headers')}
              rows={current.headers}
              scopes={scopes}
              showDescription
              onChange={(headers) => update({ headers })}
            />
          </TabsContent>
          <TabsContent value="body" className="h-full">
            <BodyEditor body={current.body} scopes={scopes} onChange={(body) => update({ body })} />
          </TabsContent>
          <TabsContent value="auth">
            <AuthEditor auth={current.auth} scopes={scopes} onChange={(auth) => update({ auth })} />
          </TabsContent>
          <TabsContent value="scripts" className="h-full">
            <ScriptsEditor events={current.events} onChange={(events) => update({ events })} />
          </TabsContent>
          <TabsContent value="settings">
            <RequestSettings
              settings={current.settings}
              onChange={(settings) => update({ settings })}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
