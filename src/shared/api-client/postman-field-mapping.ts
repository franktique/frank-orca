import type {
  Auth,
  AuthType,
  Body,
  BodyMode,
  KeyValue,
  PostmanExtra,
  Script,
  ScriptEvents,
  Variable
} from './api-client-types'
import type {
  PostmanAuth,
  PostmanBody,
  PostmanEvent,
  PostmanKeyValue,
  PostmanUrlObject,
  PostmanVariable
} from './postman-schema'

type Loose = Record<string, unknown>

export function omitKeys(source: Loose, keys: readonly string[]): Loose {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)))
}

export function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isEmptyObject(value: Loose): boolean {
  return Object.keys(value).length === 0
}

/** Only attaches `postmanExtra` when there is something to keep. */
export function withExtra<T extends object>(value: T, extra: Loose): T & { postmanExtra?: Loose } {
  return isEmptyObject(extra) ? value : { ...value, postmanExtra: extra }
}

export function descriptionText(description: unknown): { text?: string; original?: unknown } {
  if (typeof description === 'string') {
    return { text: description }
  }
  if (isRecord(description)) {
    const content = description.content
    return { text: typeof content === 'string' ? content : undefined, original: description }
  }
  return {}
}

const KEY_VALUE_KEYS = ['key', 'value', 'disabled', 'description', 'type'] as const

export function mapKeyValues(rows: readonly PostmanKeyValue[] | undefined): KeyValue[] {
  return (rows ?? []).map((row) => {
    const { text, original } = descriptionText(row.description)
    const extra = {
      ...omitKeys(row, KEY_VALUE_KEYS),
      ...(original !== undefined && typeof row.description !== 'string'
        ? { descriptionObject: original }
        : {})
    }
    return withExtra(
      {
        key: row.key ?? '',
        value: stringifyValue(row.value),
        enabled: row.disabled !== true,
        ...(text !== undefined ? { description: text } : {}),
        ...(row.type !== undefined ? { type: row.type } : {})
      },
      extra
    )
  })
}

/** v2.0 allowed headers as one `Key: value` per line. */
export function parseHeaderString(headers: string): PostmanKeyValue[] {
  return headers
    .split(/\r?\n/)
    .filter((line) => line.includes(':'))
    .map((line) => {
      const index = line.indexOf(':')
      return { key: line.slice(0, index).trim(), value: line.slice(index + 1).trim() }
    })
}

const VARIABLE_KEYS = ['key', 'value', 'disabled', 'description'] as const

export function mapVariables(rows: readonly PostmanVariable[] | undefined): Variable[] {
  return (rows ?? []).map((row) => {
    const { text } = descriptionText(row.description)
    return withExtra(
      {
        key: row.key ?? '',
        value: stringifyValue(row.value),
        enabled: row.disabled !== true,
        ...(text !== undefined ? { description: text } : {})
      },
      omitKeys(row, VARIABLE_KEYS)
    )
  })
}

// ─── Auth ───────────────────────────────────────────────────────────

const KNOWN_AUTH_TYPES: readonly AuthType[] = [
  'noauth',
  'bearer',
  'basic',
  'apikey',
  'oauth1',
  'oauth2',
  'digest',
  'awsv4',
  'hawk',
  'ntlm',
  'edgegrid',
  'jwt',
  'asap'
]

function authAttributes(auth: PostmanAuth): { key: string; value: unknown; type?: string }[] {
  const raw = auth[auth.type]
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) =>
      isRecord(entry) && typeof entry.key === 'string'
        ? [
            {
              key: entry.key,
              value: entry.value,
              type: typeof entry.type === 'string' ? entry.type : 'string'
            }
          ]
        : []
    )
  }
  // v2.0 object form.
  return isRecord(raw)
    ? Object.entries(raw).map(([key, value]) => ({ key, value, type: 'string' }))
    : []
}

function isAuthType(value: string): value is AuthType {
  return KNOWN_AUTH_TYPES.some((known) => known === value)
}

export function mapAuth(auth: PostmanAuth | undefined): Auth | undefined {
  if (!auth) {
    return undefined
  }
  if (!isAuthType(auth.type)) {
    // Why noauth + raw: the type is outside what Orca models; the file must still export unchanged.
    return { type: 'noauth', params: {}, postmanExtra: { rawAuth: auth } }
  }
  const attributes = authAttributes(auth)
  const params = Object.fromEntries(attributes.map((a) => [a.key, stringifyValue(a.value)]))
  return withExtra(
    { type: auth.type, params },
    { attrs: attributes, ...omitKeys(auth, ['type', auth.type]) }
  )
}

// ─── Scripts ────────────────────────────────────────────────────────

export function execLines(exec: string | string[] | undefined): string[] {
  if (exec === undefined) {
    return []
  }
  return Array.isArray(exec) ? exec : exec.split('\n')
}

/** `eventOrder` keeps the original listing order so an unmodified export compares equal. */
export function mapEvents(events: readonly PostmanEvent[] | undefined): {
  events: ScriptEvents
  extra: PostmanExtra
} {
  const result: ScriptEvents = {}
  const unmodelled: PostmanEvent[] = []
  const order: string[] = []
  for (const event of events ?? []) {
    order.push(event.listen)
    const slot =
      event.listen === 'prerequest' ? 'prerequest' : event.listen === 'test' ? 'test' : null
    if (!slot || !event.script || result[slot]) {
      unmodelled.push(event)
      continue
    }
    const script: Script = withExtra(
      {
        exec: execLines(event.script.exec),
        ...(event.script.id !== undefined ? { id: event.script.id } : {})
      },
      {
        script: omitKeys(event.script, ['exec', 'id']),
        event: omitKeys(event, ['listen', 'script'])
      }
    )
    result[slot] = script
  }
  const extra: PostmanExtra = {}
  if (unmodelled.length > 0) {
    extra.unmodelledEvents = unmodelled
  }
  if (order.length > 0) {
    extra.eventOrder = order
  }
  return { events: result, extra }
}

// ─── Body ───────────────────────────────────────────────────────────

const BODY_MODES: readonly BodyMode[] = ['none', 'raw', 'urlencoded', 'formdata', 'file', 'graphql']

function toBodyMode(mode: string | undefined): BodyMode {
  return BODY_MODES.find((candidate) => candidate === mode) ?? 'none'
}

export function mapBody(body: PostmanBody | undefined): Body | undefined {
  if (!body) {
    return undefined
  }
  const mode = toBodyMode(body.mode)
  const rawOptions = isRecord(body.options?.raw) ? body.options.raw : undefined
  const language = typeof rawOptions?.language === 'string' ? rawOptions.language : undefined
  const mapped: Body = {
    mode,
    ...(body.raw !== undefined ? { raw: body.raw } : {}),
    ...(language ? { language } : {}),
    ...(body.urlencoded ? { urlencoded: mapKeyValues(body.urlencoded) } : {}),
    ...(body.formdata ? { formdata: mapKeyValues(body.formdata) } : {}),
    ...(body.graphql
      ? {
          graphql: {
            query: body.graphql.query ?? '',
            ...(body.graphql.variables !== undefined
              ? { variables: stringifyValue(body.graphql.variables) }
              : {})
          }
        }
      : {})
  }
  const extra = {
    ...omitKeys(body, ['mode', 'raw', 'urlencoded', 'formdata', 'graphql']),
    ...(body.graphql && typeof body.graphql.variables !== 'string'
      ? { graphqlVariablesOriginal: body.graphql.variables }
      : {}),
    ...(body.mode !== undefined && body.mode !== mode ? { originalMode: body.mode } : {})
  }
  return withExtra(mapped, extra)
}

// ─── URL ────────────────────────────────────────────────────────────

function joinHost(host: PostmanUrlObject['host']): string {
  return Array.isArray(host) ? host.join('.') : (host ?? '')
}

function joinPath(path: PostmanUrlObject['path']): string {
  if (Array.isArray(path)) {
    return path
      .map((segment) => (typeof segment === 'string' ? segment : stringifyValue(segment.value)))
      .join('/')
  }
  return path ?? ''
}

export function buildRawUrl(url: PostmanUrlObject): string {
  const protocol = url.protocol ? `${url.protocol}://` : ''
  const port = url.port !== undefined ? `:${url.port}` : ''
  const path = joinPath(url.path)
  const enabledQuery = (url.query ?? []).filter((param) => param.disabled !== true)
  const query = enabledQuery.length
    ? `?${enabledQuery.map((param) => `${param.key ?? ''}=${stringifyValue(param.value)}`).join('&')}`
    : ''
  const hash = url.hash ? `#${url.hash}` : ''
  return `${protocol}${joinHost(url.host)}${port}${path ? `/${path}` : ''}${query}${hash}`
}

export function parseQueryFromRaw(raw: string): KeyValue[] {
  const withoutHash = raw.split('#')[0]
  const queryStart = withoutHash.indexOf('?')
  if (queryStart === -1) {
    return []
  }
  return withoutHash
    .slice(queryStart + 1)
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const index = pair.indexOf('=')
      return {
        key: index === -1 ? pair : pair.slice(0, index),
        value: index === -1 ? '' : pair.slice(index + 1),
        enabled: true
      }
    })
}
