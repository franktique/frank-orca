import type {
  ApiFolder,
  ApiItem,
  ApiRequest,
  Collection,
  Environment,
  EnvironmentVariable,
  RequestUrl
} from './api-client-types'
import {
  buildRawUrl,
  descriptionText,
  isRecord,
  mapAuth,
  mapBody,
  mapEvents,
  mapKeyValues,
  mapVariables,
  omitKeys,
  parseHeaderString,
  parseQueryFromRaw,
  stringifyValue
} from './postman-field-mapping'
import {
  describeSchemaIssue,
  detectPostmanFileKind,
  postmanCollectionSchema,
  postmanEnvironmentSchema,
  postmanGroupSchema,
  postmanRequestItemSchema,
  type PostmanGroup,
  type PostmanRequest,
  type PostmanRequestItem
} from './postman-schema'
import {
  capWarnings,
  scanScriptWarnings,
  unsupportedFeatureWarnings
} from './postman-import-warnings'

export type PostmanImportContext = {
  newId: () => string
  /** Node ids already used in the worktree; a clash gets a fresh id (FR-034). */
  takenIds?: ReadonlySet<string>
}

export type PostmanImportResult =
  | { ok: true; kind: 'collection'; collection: Collection; warnings: string[] }
  | { ok: true; kind: 'environment'; environment: Environment; warnings: string[] }
  | { ok: false; message: string }

class ImportFailure extends Error {}

type Walk = {
  ids: IdAllocator
  warnings: string[]
}

class IdAllocator {
  private readonly used: Set<string>
  constructor(
    taken: ReadonlySet<string> | undefined,
    private readonly newId: () => string
  ) {
    this.used = new Set(taken)
  }
  take(candidate: string | undefined): string {
    const id = candidate && !this.used.has(candidate) ? candidate : this.newId()
    this.used.add(id)
    return id
  }
}

const DEFAULT_UNION_MESSAGE = 'Invalid input'

type SchemaIssue = {
  path: PropertyKey[]
  message: string
  code?: string
  errors?: SchemaIssue[][]
}

/** A failed union reports every branch; the most specific one is the useful one. */
function deepestIssue(
  issue: SchemaIssue,
  prefix: PropertyKey[] = []
): { path: PropertyKey[]; message: string } {
  const path = [...prefix, ...issue.path]
  // A union with its own message ("expected string or object") already says what is wrong.
  if (issue.code !== 'invalid_union' || !issue.errors || issue.message !== DEFAULT_UNION_MESSAGE) {
    return { path, message: issue.message }
  }
  const candidates = issue.errors
    .filter((branch) => branch.length > 0)
    .map((branch) => deepestIssue(branch[0], path))
  const deepest = candidates.reduce<{ path: PropertyKey[]; message: string } | null>(
    (best, candidate) => (!best || candidate.path.length > best.path.length ? candidate : best),
    null
  )
  return deepest ?? { path, message: issue.message }
}

function parseNode<T>(
  parsed:
    | { success: true; data: T }
    | { success: false; error: { issues: readonly SchemaIssue[] } },
  pathPrefix: string
): T {
  if (parsed.success) {
    return parsed.data
  }
  throw new ImportFailure(
    describeSchemaIssue(deepestIssue(parsed.error.issues[0], splitPrefix(pathPrefix)))
  )
}

function splitPrefix(prefix: string): PropertyKey[] {
  return prefix
    .split(/\.|(?=\[)/)
    .filter(Boolean)
    .map((segment) => (segment.startsWith('[') ? Number(segment.slice(1, -1)) : segment))
}

function mapUrl(url: PostmanRequest['url']): {
  url: RequestUrl
  pathVariables: ApiRequest['pathVariables']
  extra: Record<string, unknown>
} {
  if (typeof url === 'string' || url === undefined) {
    const raw = url ?? ''
    return { url: { raw, query: parseQueryFromRaw(raw) }, pathVariables: [], extra: {} }
  }
  const raw = url.raw ?? buildRawUrl(url)
  const query = url.query ? mapKeyValues(url.query) : parseQueryFromRaw(raw)
  return {
    url: { raw, query },
    pathVariables: mapKeyValues(url.variable),
    // Why: host/path/protocol are derived from raw on export unless raw is unchanged.
    extra: {
      urlParts: omitKeys(url, ['raw', 'query', 'variable']),
      urlRawAtImport: raw,
      ...(url.query ? {} : { queryDerived: true })
    }
  }
}

function mapRequestItem(item: PostmanRequestItem, walk: Walk): ApiRequest {
  const rawRequest =
    typeof item.request === 'string' ? { url: item.request, method: 'GET' } : item.request
  const request: PostmanRequest = rawRequest
  const urlMapping = mapUrl(request.url)
  const headers =
    typeof request.header === 'string' ? parseHeaderString(request.header) : request.header
  const itemDescription = descriptionText(item.description)
  const requestDescription = descriptionText(request.description)
  const { events, extra: eventExtra } = mapEvents(item.event)
  const behavior = isRecord(item.protocolProfileBehavior) ? item.protocolProfileBehavior : {}
  const auth = mapAuth(request.auth ?? item.auth)

  const mapped: ApiRequest = {
    id: walk.ids.take(item.id),
    kind: 'request',
    name: item.name,
    ...((requestDescription.text ?? itemDescription.text) !== undefined
      ? { description: requestDescription.text ?? itemDescription.text }
      : {}),
    method: (request.method ?? 'GET').toUpperCase(),
    url: urlMapping.url,
    pathVariables: urlMapping.pathVariables,
    headers: mapKeyValues(headers),
    ...(request.body ? { body: mapBody(request.body) } : {}),
    ...(auth ? { auth } : {}),
    events,
    settings: {
      ...(typeof behavior.strictSSL === 'boolean' ? { sslVerification: behavior.strictSSL } : {}),
      ...(typeof behavior.followRedirects === 'boolean'
        ? { followRedirects: behavior.followRedirects }
        : {})
    },
    revision: 0,
    postmanExtra: {
      item: omitKeys(item, [
        'id',
        'name',
        'description',
        'request',
        'event',
        'auth',
        'protocolProfileBehavior'
      ]),
      request: omitKeys(request, ['url', 'method', 'header', 'body', 'auth', 'description']),
      ...(item.auth && !request.auth ? { authAt: 'item' } : {}),
      ...(itemDescription.text !== undefined && requestDescription.text === undefined
        ? { descriptionAt: 'item' }
        : {}),
      ...(typeof item.request === 'string' ? { requestWasString: true } : {}),
      ...(typeof request.header === 'string' ? { headerWasString: true } : {}),
      ...(isRecord(item.protocolProfileBehavior)
        ? {
            protocolProfileBehavior: omitKeys(behavior, ['strictSSL', 'followRedirects'])
          }
        : {}),
      ...urlMapping.extra,
      ...eventExtra
    }
  }

  walk.warnings.push(
    ...scanScriptWarnings(mapped.name, mapped.events),
    ...unsupportedFeatureWarnings(mapped)
  )
  return mapped
}

function mapGroup(group: PostmanGroup, walk: Walk, location: string): ApiFolder {
  const { text, original } = descriptionText(group.description)
  const { events, extra: eventExtra } = mapEvents(group.event)
  const groupAuth = mapAuth(group.auth)
  const folder: ApiFolder = {
    id: walk.ids.take(group.id),
    kind: 'folder',
    name: group.name,
    ...(text !== undefined ? { description: text } : {}),
    variables: mapVariables(group.variable),
    ...(groupAuth ? { auth: groupAuth } : {}),
    events,
    items: mapItems(group.item, walk, location),
    postmanExtra: {
      ...omitKeys(group, ['id', 'name', 'description', 'item', 'event', 'variable', 'auth']),
      ...(original !== undefined && typeof group.description !== 'string'
        ? { descriptionObject: original }
        : {}),
      ...eventExtra
    }
  }
  walk.warnings.push(...scanScriptWarnings(folder.name, folder.events))
  return folder
}

function mapItems(items: readonly unknown[], walk: Walk, location: string): ApiItem[] {
  return items.map((node, index) => {
    const path = `${location}[${index}]`
    if (isRecord(node) && Array.isArray(node.item)) {
      return mapGroup(parseNode(postmanGroupSchema.safeParse(node), path), walk, `${path}.item`)
    }
    return mapRequestItem(parseNode(postmanRequestItemSchema.safeParse(node), path), walk)
  })
}

function importCollection(json: unknown, ctx: PostmanImportContext): PostmanImportResult {
  const parsed = postmanCollectionSchema.safeParse(json)
  const file = parseNode(parsed, '')
  const walk: Walk = { ids: new IdAllocator(ctx.takenIds, ctx.newId), warnings: [] }
  const { text, original } = descriptionText(file.info.description)
  const { events, extra: eventExtra } = mapEvents(file.event)
  const collectionAuth = mapAuth(file.auth)
  const collection: Collection = {
    id: walk.ids.take(file.info._postman_id),
    name: file.info.name,
    ...(text !== undefined ? { description: text } : {}),
    variables: mapVariables(file.variable),
    ...(collectionAuth ? { auth: collectionAuth } : {}),
    events,
    items: mapItems(file.item, walk, 'item'),
    revision: 0,
    postmanExtra: {
      info: omitKeys(file.info, ['_postman_id', 'name', 'description', 'schema']),
      root: omitKeys(file, ['info', 'item', 'event', 'variable', 'auth']),
      ...(original !== undefined && typeof file.info.description !== 'string'
        ? { descriptionObject: original }
        : {}),
      ...eventExtra
    },
    importWarnings: []
  }
  walk.warnings.push(...scanScriptWarnings(collection.name, collection.events))
  const warnings = capWarnings(walk.warnings)
  collection.importWarnings = warnings
  return { ok: true, kind: 'collection', collection, warnings }
}

function importEnvironment(json: unknown, ctx: PostmanImportContext): PostmanImportResult {
  const file = parseNode(postmanEnvironmentSchema.safeParse(json), '')
  const ids = new IdAllocator(ctx.takenIds, ctx.newId)
  const variables: EnvironmentVariable[] = file.values.map((entry) => ({
    key: entry.key ?? '',
    value: stringifyValue(entry.value),
    enabled: entry.enabled !== false,
    type: entry.type === 'secret' ? 'secret' : 'default'
  }))
  const environment: Environment = {
    id: ids.take(file.id),
    name: file.name,
    variables,
    revision: 0,
    postmanExtra: omitKeys(file, ['id', 'name', 'values'])
  }
  return { ok: true, kind: 'environment', environment, warnings: [] }
}

/** Parses a Postman v2.0/v2.1 collection or environment export. Never throws. */
export function importPostmanJson(json: unknown, ctx: PostmanImportContext): PostmanImportResult {
  const kind = detectPostmanFileKind(json)
  if (!kind) {
    return { ok: false, message: 'This file is not a Postman collection or environment.' }
  }
  try {
    return kind === 'collection' ? importCollection(json, ctx) : importEnvironment(json, ctx)
  } catch (error) {
    if (error instanceof ImportFailure) {
      return { ok: false, message: error.message }
    }
    throw error
  }
}

export type { PostmanRequest }
