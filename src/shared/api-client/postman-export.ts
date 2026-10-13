import type {
  ApiFolder,
  ApiItem,
  ApiRequest,
  Auth,
  Body,
  Collection,
  KeyValue,
  PostmanExtra,
  Script,
  ScriptEvents
} from './api-client-types'
import { exportKeyValues, exportVariables } from './postman-environment-export'
import { isRecord, omitKeys, parseQueryFromRaw, stringifyValue } from './postman-field-mapping'

type Loose = Record<string, unknown>

const COLLECTION_SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const EVENT_EXTRA_KEYS = ['eventOrder', 'unmodelledEvents'] as const

function record(value: unknown): Loose {
  return isRecord(value) ? value : {}
}

function withDefined(entries: Loose): Loose {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

// ─── Auth ───────────────────────────────────────────────────────────

function exportAuth(auth: Auth | undefined): Loose | undefined {
  if (!auth || auth.type === 'inherit') {
    return undefined
  }
  const extra = record(auth.postmanExtra)
  if (isRecord(extra.rawAuth)) {
    return extra.rawAuth
  }
  const original = Array.isArray(extra.attrs) ? extra.attrs.filter(isRecord) : []
  const attrs = Object.entries(auth.params).map(([key, value]) => {
    const previous = original.find((attr) => attr.key === key)
    // Keep the original value (and its type) while the edited string still matches it.
    return previous && stringifyValue(previous.value) === value
      ? previous
      : { key, value, type: typeof previous?.type === 'string' ? previous.type : 'string' }
  })
  return {
    ...omitKeys(extra, ['attrs', 'rawAuth']),
    type: auth.type,
    ...(attrs.length > 0 ? { [auth.type]: attrs } : {})
  }
}

// ─── Scripts ────────────────────────────────────────────────────────

function exportScript(listen: 'prerequest' | 'test', script: Script): Loose {
  const extra = record(script.postmanExtra)
  return {
    ...record(extra.event),
    listen,
    script: {
      type: 'text/javascript',
      ...record(extra.script),
      exec: script.exec,
      ...(script.id !== undefined ? { id: script.id } : {})
    }
  }
}

/** Re-emits events in their original order; scripts added since import follow. */
function exportEvents(events: ScriptEvents, extra: PostmanExtra): Loose[] | undefined {
  const modelled = (['prerequest', 'test'] as const).flatMap((listen) => {
    const script = events[listen]
    return script && script.exec.length > 0 ? [{ listen, event: exportScript(listen, script) }] : []
  })
  const unmodelled = Array.isArray(extra.unmodelledEvents) ? [...extra.unmodelledEvents] : []
  const order = Array.isArray(extra.eventOrder) ? extra.eventOrder : []
  const result: Loose[] = []
  for (const listen of order) {
    const index = modelled.findIndex((entry) => entry.listen === listen)
    if (index !== -1) {
      result.push(modelled.splice(index, 1)[0].event)
      continue
    }
    const loose = unmodelled.findIndex((event) => isRecord(event) && event.listen === listen)
    if (loose !== -1) {
      result.push(record(unmodelled.splice(loose, 1)[0]))
    }
  }
  result.push(...modelled.map((entry) => entry.event), ...unmodelled.map(record))
  return result.length > 0 ? result : undefined
}

// ─── URL ────────────────────────────────────────────────────────────

const RAW_URL_PATTERN =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/?#:]*)(?::(\d+))?([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/i

function splitRawUrl(raw: string): Loose {
  const match = RAW_URL_PATTERN.exec(raw)
  if (!match) {
    return {}
  }
  const [, protocol, host, port, path, hash] = match
  return withDefined({
    protocol,
    host: host ? host.split('.') : undefined,
    port,
    path: path ? path.split('/').filter((segment) => segment.length > 0) : undefined,
    hash
  })
}

function exportUrl(request: ApiRequest, extra: Loose): Loose | string {
  const { raw, query } = request.url
  const parts = isRecord(extra.urlParts) ? extra.urlParts : undefined
  const queryIsDerived = extra.queryDerived === true && sameRows(query, parseQueryFromRaw(raw))
  const hasDisabled = query.some((row) => !row.enabled)
  if (!parts && request.pathVariables.length === 0 && !hasDisabled) {
    return raw
  }
  const unchanged = extra.urlRawAtImport === raw
  const base = unchanged
    ? parts
    : omitKeys(record(parts), ['protocol', 'host', 'port', 'path', 'hash'])
  return {
    ...(unchanged ? {} : splitRawUrl(raw)),
    ...base,
    raw,
    ...(queryIsDerived || (!parts && query.length === 0) ? {} : { query: exportKeyValues(query) }),
    ...(request.pathVariables.length > 0
      ? { variable: exportKeyValues(request.pathVariables) }
      : {})
  }
}

function sameRows(left: readonly KeyValue[], right: readonly KeyValue[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.key === right[index].key && row.value === right[index].value && row.enabled
    )
  )
}

// ─── Body ───────────────────────────────────────────────────────────

function exportBody(body: Body | undefined): Loose | undefined {
  if (!body) {
    return undefined
  }
  const extra = record(body.postmanExtra)
  const rawOptions = record(record(extra.options).raw)
  const mode =
    body.mode === 'none' && typeof extra.originalMode === 'string' ? extra.originalMode : body.mode
  const graphqlVariables = body.graphql?.variables
  const original = extra.graphqlVariablesOriginal
  return {
    ...omitKeys(extra, ['originalMode', 'graphqlVariablesOriginal']),
    mode,
    ...(body.raw !== undefined ? { raw: body.raw } : {}),
    ...(body.language
      ? { options: { ...record(extra.options), raw: { ...rawOptions, language: body.language } } }
      : {}),
    ...(body.urlencoded ? { urlencoded: exportKeyValues(body.urlencoded) } : {}),
    ...(body.formdata ? { formdata: exportKeyValues(body.formdata) } : {}),
    ...(body.graphql
      ? {
          graphql: {
            query: body.graphql.query,
            ...(graphqlVariables !== undefined
              ? {
                  variables:
                    original !== undefined && stringifyValue(original) === graphqlVariables
                      ? original
                      : graphqlVariables
                }
              : {})
          }
        }
      : {})
  }
}

// ─── Items ──────────────────────────────────────────────────────────

function exportHeaders(request: ApiRequest, extra: Loose): Loose[] | string | undefined {
  if (request.headers.length === 0) {
    return undefined
  }
  const plain = request.headers.every((row) => row.enabled && !row.postmanExtra)
  return extra.headerWasString === true && plain
    ? request.headers.map((row) => `${row.key}: ${row.value}`).join('\n')
    : exportKeyValues(request.headers)
}

function exportRequest(request: ApiRequest): Loose {
  const extra = request.postmanExtra
  const url = exportUrl(request, extra)
  const header = exportHeaders(request, extra)
  const body = exportBody(request.body)
  const auth = exportAuth(request.auth)
  const itemLevelAuth = extra.authAt === 'item'
  const itemLevelDescription = extra.descriptionAt === 'item'
  const behavior = withDefined({
    ...record(extra.protocolProfileBehavior),
    strictSSL: request.settings.sslVerification,
    followRedirects: request.settings.followRedirects
  })
  const requestExtra = record(extra.request)

  const bare =
    extra.requestWasString === true &&
    typeof url === 'string' &&
    request.method === 'GET' &&
    !header &&
    !body &&
    !auth &&
    !request.description &&
    Object.keys(requestExtra).length === 0
  const event = exportEvents(request.events, extra)

  return {
    ...record(extra.item),
    id: request.id,
    name: request.name,
    ...(itemLevelDescription && request.description !== undefined
      ? { description: request.description }
      : {}),
    ...(Object.keys(behavior).length > 0 ? { protocolProfileBehavior: behavior } : {}),
    ...(event ? { event } : {}),
    ...(itemLevelAuth && auth ? { auth } : {}),
    request: bare
      ? url
      : {
          ...requestExtra,
          method: request.method,
          url,
          ...(header !== undefined ? { header } : {}),
          ...(body ? { body } : {}),
          ...(!itemLevelAuth && auth ? { auth } : {}),
          ...(!itemLevelDescription && request.description !== undefined
            ? { description: request.description }
            : {})
        }
  }
}

function exportFolder(folder: ApiFolder): Loose {
  const { descriptionObject, ...extra } = omitKeys(folder.postmanExtra, EVENT_EXTRA_KEYS)
  const auth = exportAuth(folder.auth)
  const event = exportEvents(folder.events, folder.postmanExtra)
  return {
    ...extra,
    id: folder.id,
    name: folder.name,
    ...(descriptionObject !== undefined
      ? { description: descriptionObject }
      : folder.description !== undefined
        ? { description: folder.description }
        : {}),
    ...(folder.variables.length > 0 ? { variable: exportVariables(folder.variables) } : {}),
    ...(auth ? { auth } : {}),
    ...(event ? { event } : {}),
    item: folder.items.map(exportItem)
  }
}

function exportItem(item: ApiItem): Loose {
  return item.kind === 'folder' ? exportFolder(item) : exportRequest(item)
}

// ─── Entry points ───────────────────────────────────────────────────

/** Internal collection → Postman Collection v2.1 JSON. */
export function exportPostmanCollection(collection: Collection): Loose {
  const extra = collection.postmanExtra
  const { descriptionObject } = extra
  const auth = exportAuth(collection.auth)
  const event = exportEvents(collection.events, extra)
  return {
    info: {
      ...record(extra.info),
      _postman_id: collection.id,
      name: collection.name,
      ...(descriptionObject !== undefined
        ? { description: descriptionObject }
        : collection.description !== undefined
          ? { description: collection.description }
          : {}),
      schema: COLLECTION_SCHEMA_URL
    },
    item: collection.items.map(exportItem),
    ...(event ? { event } : {}),
    ...(collection.variables.length > 0 ? { variable: exportVariables(collection.variables) } : {}),
    ...(auth ? { auth } : {}),
    ...record(extra.root)
  }
}
