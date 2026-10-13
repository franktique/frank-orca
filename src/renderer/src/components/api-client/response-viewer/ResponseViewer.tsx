import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { LatestResult } from '../../../../../shared/api-client/api-client-types'
import ResponseBody from './ResponseBody'
import ResponseHeaders from './ResponseHeaders'
import ResponseSummary from './ResponseSummary'
import TestResultsList from './TestResultsList'

export default function ResponseViewer({
  result
}: {
  result: LatestResult | undefined
}): React.JSX.Element {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {translate('apiClient.response.empty', 'Send the request to see the response.')}
      </div>
    )
  }
  const passed = result.tests.filter((test) => test.passed).length
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <ResponseSummary result={result} />
      {result.outcome.kind === 'error' ? (
        <p className="text-sm text-destructive" role="alert">
          {result.outcome.message}
        </p>
      ) : null}
      <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="body" disabled={result.outcome.kind !== 'response'}>
            {translate('apiClient.response.body', 'Response body')}
          </TabsTrigger>
          <TabsTrigger value="headers" disabled={result.outcome.kind !== 'response'}>
            {translate('apiClient.response.headers', 'Headers')}
          </TabsTrigger>
          <TabsTrigger value="tests">
            {translate('apiClient.response.testsCount', 'Tests ({{passed}}/{{total}})', {
              passed,
              total: result.tests.length
            })}
          </TabsTrigger>
        </TabsList>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pt-2">
          {result.outcome.kind === 'response' ? (
            <>
              <TabsContent value="body" className="h-full">
                <ResponseBody response={result.outcome.response} />
              </TabsContent>
              <TabsContent value="headers">
                <ResponseHeaders headers={result.outcome.response.headers} />
              </TabsContent>
            </>
          ) : null}
          <TabsContent value="tests">
            <TestResultsList tests={result.tests} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
