import type { ApiRequest, Auth, KeyValue } from './api-client-types'
import { appendQueryParam, buildAuthApplication } from './request-auth'
import { resolveTemplate, type VariableScope } from './variable-resolution'

export type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'form-data'; fields: { name: string; value: string }[] }

export type PreparedRequest = {
  method: string
  url: string
  headers: [string, string][]
  body: PreparedBody
  /** Variable names that stayed unresolved anywhere in the request (FR-013). */
  unresolved: string[]
}

const RAW_CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
  text: 'text/plain'
}

function hasHeader(headers: readonly [string, string][], name: string): boolean {
  return headers.some(([header]) => header.toLowerCase() === name)
}

function replacePathVariables(url: string, variables: readonly KeyValue[]): string {
  const enabled = variables.filter((variable) => variable.enabled && variable.key)
  if (enabled.length === 0) {
    return url
  }
  const queryStart = url.search(/[?#]/)
  const pathPart = queryStart === -1 ? url : url.slice(0, queryStart)
  const tail = queryStart === -1 ? '' : url.slice(queryStart)
  const replaced = pathPart.replace(
    /(\/):([A-Za-z0-9_-]+)/g,
    (match, slash: string, name: string) => {
      const variable = enabled.findLast((entry) => entry.key === name)
      return variable ? `${slash}${variable.value}` : match
    }
  )
  return replaced + tail
}

function prepareBody(
  request: ApiRequest,
  resolve: (text: string) => string
): { body: PreparedBody; contentType: string | null } {
  const body = request.body
  if (!body || body.mode === 'none') {
    return { body: { kind: 'none' }, contentType: null }
  }
  if (body.mode === 'raw') {
    return {
      body: { kind: 'text', text: resolve(body.raw ?? '') },
      contentType: RAW_CONTENT_TYPES[body.language ?? 'text'] ?? 'text/plain'
    }
  }
  if (body.mode === 'urlencoded') {
    const pairs = (body.urlencoded ?? [])
      .filter((row) => row.enabled && row.key)
      .map(
        (row) => `${encodeURIComponent(resolve(row.key))}=${encodeURIComponent(resolve(row.value))}`
      )
    return {
      body: { kind: 'text', text: pairs.join('&') },
      contentType: 'application/x-www-form-urlencoded'
    }
  }
  if (body.mode === 'formdata') {
    return {
      body: {
        kind: 'form-data',
        fields: (body.formdata ?? [])
          // File rows have no readable source here; they are kept for export only.
          .filter((row) => row.enabled && row.key && row.type !== 'file')
          .map((row) => ({ name: resolve(row.key), value: resolve(row.value) }))
      },
      contentType: null
    }
  }
  if (body.mode === 'graphql') {
    const variables = resolve(body.graphql?.variables ?? '').trim()
    let parsedVariables: unknown = {}
    if (variables) {
      try {
        parsedVariables = JSON.parse(variables)
      } catch {
        parsedVariables = {}
      }
    }
    return {
      body: {
        kind: 'text',
        text: JSON.stringify({
          query: resolve(body.graphql?.query ?? ''),
          variables: parsedVariables
        })
      },
      contentType: 'application/json'
    }
  }
  // `file` bodies are sent as raw text on a best-effort basis (data-model.md).
  return { body: { kind: 'text', text: resolve(body.raw ?? '') }, contentType: null }
}

/** Resolves every `{{variable}}` and folds the effective auth into headers or the URL. */
export function prepareRequest(
  request: ApiRequest,
  scopes: readonly VariableScope[],
  effectiveAuth: Auth | undefined
): PreparedRequest {
  const unresolved: string[] = []
  const resolve = (text: string): string => {
    const result = resolveTemplate(text, scopes)
    unresolved.push(...result.unresolved.map((span) => span.name))
    return result.text
  }

  let url = replacePathVariables(
    resolve(request.url.raw.trim()),
    request.pathVariables.map((v) => ({ ...v, value: resolve(v.value) }))
  )
  const headers: [string, string][] = request.headers
    .filter((header) => header.enabled && header.key.trim())
    .map((header) => [resolve(header.key.trim()), resolve(header.value)])

  const { body, contentType } = prepareBody(request, resolve)
  if (contentType && !hasHeader(headers, 'content-type')) {
    headers.push(['Content-Type', contentType])
  }

  if (effectiveAuth) {
    const application = buildAuthApplication(effectiveAuth, scopes)
    unresolved.push(...application.unresolved)
    if (application.header && !hasHeader(headers, application.header[0].toLowerCase())) {
      headers.push(application.header)
    }
    if (application.query) {
      url = appendQueryParam(url, application.query[0], application.query[1])
    }
  }

  return {
    method: request.method.toUpperCase(),
    url,
    headers,
    body,
    unresolved: [...new Set(unresolved)]
  }
}
