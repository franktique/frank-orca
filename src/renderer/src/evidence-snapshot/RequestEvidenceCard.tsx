import { translate } from '@/i18n/i18n'
import ResponseHeaders from '@/components/api-client/response-viewer/ResponseHeaders'
import ResponseSummary from '@/components/api-client/response-viewer/ResponseSummary'
import {
  isJsonContentType,
  prettyPrintJson
} from '@/components/api-client/response-viewer/response-formatting'
import type { RequestEvidenceCardData } from '../../../shared/test-orchestrator/evidence-snapshot-card'

// Why: the card is a fixed-width screenshot, so long bodies are cut to what fits.
const MAX_BODY_LINES = 40
const MAX_LINE_CHARS = 200

function clipBody(text: string): string {
  const lines = text.split('\n')
  const clipped = lines
    .slice(0, MAX_BODY_LINES)
    .map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line))
  if (lines.length > MAX_BODY_LINES) {
    clipped.push(
      translate('evidenceSnapshot.moreLines', '… {{count}} more lines', {
        count: lines.length - MAX_BODY_LINES
      })
    )
  }
  return clipped.join('\n')
}

function BodyBlock({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-2 font-mono text-xs">
        {clipBody(text)}
      </pre>
    </section>
  )
}

export default function RequestEvidenceCard({
  card
}: {
  card: RequestEvidenceCardData
}): React.JSX.Element {
  const { resolvedRequest, outcome } = card
  const response = outcome.kind === 'response' ? outcome.response : null
  const responseText = response?.body.encoding === 'utf8' ? (response.body.text ?? '') : null
  const responseDisplay =
    responseText !== null && isJsonContentType(response?.contentType ?? null)
      ? (prettyPrintJson(responseText) ?? responseText)
      : responseText

  return (
    <article
      className="flex flex-col gap-3 bg-background p-4 text-foreground"
      data-testid="request-evidence-card"
    >
      <h2 className="text-sm font-semibold">{card.title}</h2>
      <p className="break-all font-mono text-xs">
        <span className="font-semibold">{resolvedRequest.method}</span> {resolvedRequest.url}
      </p>
      <section className="space-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('evidenceSnapshot.requestHeaders', 'Request headers')}
        </h3>
        <ResponseHeaders headers={resolvedRequest.headers} />
      </section>
      {resolvedRequest.body ? (
        <BodyBlock
          label={translate('evidenceSnapshot.requestBody', 'Request body')}
          text={resolvedRequest.body}
        />
      ) : null}
      <hr className="border-border" />
      <ResponseSummary
        result={{
          requestId: '',
          origin: 'run',
          startedAt: 0,
          durationMs: card.durationMs,
          ttfbMs: null,
          resolvedRequest,
          outcome,
          tests: [],
          scriptLogs: [],
          environmentId: null
        }}
      />
      {outcome.kind === 'error' ? (
        <p className="text-sm text-destructive" role="alert">
          {outcome.message}
        </p>
      ) : null}
      {response ? (
        <>
          <section className="space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {translate('apiClient.response.headers', 'Headers')}
            </h3>
            <ResponseHeaders headers={response.headers} />
          </section>
          {responseDisplay !== null ? (
            <BodyBlock
              label={translate('apiClient.response.body', 'Response body')}
              text={responseDisplay}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate('evidenceSnapshot.bodyNotShown', 'Response body not shown as text.')}
            </p>
          )}
        </>
      ) : null}
    </article>
  )
}
