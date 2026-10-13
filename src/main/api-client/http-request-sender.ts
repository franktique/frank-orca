import type { PreparedBody, PreparedRequest } from '../../shared/api-client/request-preparation'
import {
  API_CLIENT_LIMITS,
  type ApiErrorCode,
  type ResponseSnapshot
} from '../../shared/api-client/api-client-types'

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>

export type HttpSendInput = {
  prepared: PreparedRequest
  verifySsl: boolean
  followRedirects: boolean
  timeoutMs: number
  signal?: AbortSignal
}

export type HttpSendResult = {
  durationMs: number
  ttfbMs: number | null
  /** Headers Chromium forbids scripts to set; they are not sent (R5). */
  droppedHeaders: string[]
} & ({ ok: true; response: ResponseSnapshot } | { ok: false; code: ApiErrorCode; message: string })

const MAX_REDIRECTS = 10
const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'keep-alive',
  'te',
  'trailer',
  'expect'
])
const TEXT_CONTENT_TYPE =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|yaml|graphql)|.*\+(json|xml))/i

export const CERTIFICATE_MESSAGE =
  "The server's certificate was rejected. Turn off SSL certificate verification in Settings, or for this request, to continue."

function describeCause(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const cause = error.cause
  const causeCode =
    typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : ''
  const causeText =
    cause instanceof Error
      ? `${causeCode} ${cause.message}`
      : typeof cause === 'string'
        ? cause
        : causeCode
  return `${error.message} ${causeText}`
}

export function mapFetchError(
  error: unknown,
  state: { timedOut: boolean; cancelled: boolean }
): { code: ApiErrorCode; message: string } {
  if (state.cancelled) {
    return { code: 'cancelled', message: 'The request was cancelled.' }
  }
  if (state.timedOut) {
    return { code: 'timeout', message: 'The request timed out.' }
  }
  const text = describeCause(error)
  if (/ERR_CERT|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|certificate|ERR_SSL/i.test(text)) {
    return { code: 'certificate', message: CERTIFICATE_MESSAGE }
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|EAI_AGAIN/i.test(text)) {
    return { code: 'dns', message: 'The host name could not be resolved.' }
  }
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) {
    return { code: 'network', message: 'The connection was refused.' }
  }
  return {
    code: 'network',
    message: error instanceof Error && error.message ? error.message : 'The request failed.'
  }
}

function toRequestBody(body: PreparedBody): BodyInit | undefined {
  if (body.kind === 'text') {
    return body.text
  }
  if (body.kind === 'form-data') {
    const form = new FormData()
    for (const field of body.fields) {
      form.append(field.name, field.value)
    }
    return form
  }
  return undefined
}

function isTextual(contentType: string | null): boolean {
  return contentType === null || TEXT_CONTENT_TYPE.test(contentType)
}

async function readBody(
  response: Response,
  contentType: string | null
): Promise<Pick<ResponseSnapshot, 'body' | 'sizeBytes'>> {
  const limit = API_CLIENT_LIMITS.responseBodyMaxBytes
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false
  const reader = response.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    received += value.byteLength
    if (received > limit) {
      const keep = value.byteLength - (received - limit)
      chunks.push(value.subarray(0, Math.max(0, keep)))
      truncated = true
      await reader.cancel().catch(() => undefined)
      break
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  const declared = Number(response.headers.get('content-length'))
  const sizeBytes = truncated && Number.isFinite(declared) && declared > 0 ? declared : received
  if (bytes.length === 0) {
    return { sizeBytes, body: { encoding: 'utf8', text: '', truncated } }
  }
  if (isTextual(contentType)) {
    try {
      return {
        sizeBytes,
        body: {
          encoding: 'utf8',
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          truncated
        }
      }
    } catch {
      // Not valid UTF-8 (or cut mid-character): treat as binary.
    }
  }
  return { sizeBytes, body: { encoding: 'base64', text: bytes.toString('base64'), truncated } }
}

function redirectedRequest(
  status: number,
  method: string,
  body: BodyInit | undefined
): { method: string; body: BodyInit | undefined } {
  const switchToGet = status === 303 || ((status === 301 || status === 302) && method === 'POST')
  return switchToGet ? { method: 'GET', body: undefined } : { method, body }
}

export class HttpRequestSender {
  constructor(private readonly fetchFor: (verifySsl: boolean) => FetchFunction) {}

  async send(input: HttpSendInput): Promise<HttpSendResult> {
    const startedAt = performance.now()
    const droppedHeaders: string[] = []
    const base = (ttfbMs: number | null) => ({
      durationMs: Math.round(performance.now() - startedAt),
      ttfbMs,
      droppedHeaders
    })

    let target: URL
    try {
      target = new URL(input.prepared.url)
    } catch {
      return {
        ...base(null),
        ok: false,
        code: 'invalid-url',
        message: 'Enter a full URL, including http:// or https://.'
      }
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return {
        ...base(null),
        ok: false,
        code: 'invalid-url',
        message: 'Only http and https URLs are supported.'
      }
    }

    const headers = new Headers()
    for (const [name, value] of input.prepared.headers) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
        droppedHeaders.push(name)
        continue
      }
      headers.append(name, value)
    }

    const controller = new AbortController()
    const state = { timedOut: false, cancelled: false }
    const onAbort = (): void => {
      state.cancelled = true
      controller.abort()
    }
    input.signal?.addEventListener('abort', onAbort)
    if (input.signal?.aborted) {
      onAbort()
    }
    const timer =
      input.timeoutMs > 0
        ? setTimeout(() => {
            state.timedOut = true
            controller.abort()
          }, input.timeoutMs)
        : null

    const fetchImpl = this.fetchFor(input.verifySsl)
    const redirects: ResponseSnapshot['redirects'] = []
    let ttfbMs: number | null = null
    try {
      let method = input.prepared.method
      let body = toRequestBody(input.prepared.body)
      let url = target.toString()
      for (let hop = 0; ; hop++) {
        const response = await fetchImpl(url, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal
        })
        ttfbMs ??= Math.round(performance.now() - startedAt)
        const location = response.headers.get('location')
        const isRedirect = response.status >= 300 && response.status < 400 && location !== null
        if (isRedirect && input.followRedirects) {
          if (hop >= MAX_REDIRECTS) {
            await response.body?.cancel().catch(() => undefined)
            return {
              ...base(ttfbMs),
              ok: false,
              code: 'network',
              message: `Stopped after ${MAX_REDIRECTS} redirects.`
            }
          }
          redirects.push({ url, status: response.status })
          await response.body?.cancel().catch(() => undefined)
          url = new URL(location, url).toString()
          const next = redirectedRequest(response.status, method, body)
          method = next.method
          body = next.body
          if (next.body === undefined) {
            headers.delete('content-type')
          }
          continue
        }
        const contentType = response.headers.get('content-type')
        const { body: snapshotBody, sizeBytes } = await readBody(response, contentType)
        return {
          ...base(ttfbMs),
          ok: true,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
            sizeBytes,
            contentType,
            body: snapshotBody,
            redirects
          }
        }
      }
    } catch (error) {
      return { ...base(ttfbMs), ok: false, ...mapFetchError(error, state) }
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
      input.signal?.removeEventListener('abort', onAbort)
    }
  }
}
