import { z } from 'zod'

// Why loose objects: Postman files carry fields we do not model, and every one of them must
// survive import → export. Validation only pins down the structure the importer relies on.
const looseObject = z.looseObject

const description = z.union([z.string(), looseObject({ content: z.string().optional() })])

const stringOrStrings = z.union([z.string(), z.array(z.string())])

const keyValue = looseObject({
  key: z.string().nullish(),
  value: z.unknown().optional(),
  disabled: z.boolean().optional(),
  description: description.optional(),
  type: z.string().optional()
})

const urlObject = looseObject({
  raw: z.string().optional(),
  protocol: z.string().optional(),
  host: stringOrStrings.optional(),
  path: z.union([z.string(), z.array(z.union([z.string(), looseObject({})]))]).optional(),
  port: z.union([z.string(), z.number()]).optional(),
  query: z.array(keyValue).optional(),
  variable: z.array(keyValue).optional(),
  hash: z.string().optional()
})

const url = z.union([z.string(), urlObject], { error: 'expected string or object' })

const authAttribute = looseObject({ key: z.string(), value: z.unknown().optional() })

// v2.1 lists attributes as `[{ key, value }]`; v2.0 used a plain `{ token: '…' }` object.
const authParams = z.union([z.array(authAttribute), z.record(z.string(), z.unknown())])

const auth = looseObject({ type: z.string() })

const script = looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  exec: stringOrStrings.optional()
})

const event = looseObject({
  listen: z.string(),
  script: script.optional(),
  disabled: z.boolean().optional()
})

const body = looseObject({
  mode: z.string().optional(),
  raw: z.string().optional(),
  urlencoded: z.array(keyValue).optional(),
  formdata: z.array(keyValue).optional(),
  graphql: looseObject({
    query: z.string().optional(),
    variables: z.union([z.string(), looseObject({})]).optional()
  }).optional(),
  options: looseObject({}).optional()
})

const request = looseObject({
  url: url.optional(),
  method: z.string().optional(),
  header: z.union([z.array(keyValue), z.string()]).optional(),
  body: body.optional(),
  auth: auth.optional(),
  description: description.optional()
})

const variable = looseObject({
  id: z.string().optional(),
  key: z.string().nullish(),
  value: z.unknown().optional(),
  type: z.string().optional(),
  disabled: z.boolean().optional(),
  description: description.optional()
})

const itemBase = {
  id: z.string().optional(),
  name: z.string(),
  description: description.optional(),
  event: z.array(event).optional(),
  variable: z.array(variable).optional(),
  auth: auth.optional(),
  protocolProfileBehavior: looseObject({}).optional()
}

// Why not one recursive schema: the importer walks the tree itself, so every issue carries
// the exact `item[3].item[0]…` path and the types stay free of recursive-schema casts.
export const postmanRequestItemSchema = looseObject({
  ...itemBase,
  request: z.union([request, z.string()]),
  response: z.array(z.unknown()).optional()
})

export const postmanGroupSchema = looseObject({
  ...itemBase,
  item: z.array(z.unknown())
})

export const postmanCollectionSchema = looseObject({
  info: looseObject({
    _postman_id: z.string().optional(),
    name: z.string(),
    description: description.optional(),
    schema: z.string().optional()
  }),
  item: z.array(z.unknown()),
  event: z.array(event).optional(),
  variable: z.array(variable).optional(),
  auth: auth.optional(),
  protocolProfileBehavior: looseObject({}).optional()
})

export const postmanEnvironmentSchema = looseObject({
  id: z.string().optional(),
  name: z.string(),
  values: z.array(
    looseObject({
      key: z.string().nullish(),
      value: z.unknown().optional(),
      type: z.string().optional(),
      enabled: z.boolean().optional(),
      description: description.optional()
    })
  )
})

export type PostmanRequestItem = z.infer<typeof postmanRequestItemSchema>
export type PostmanGroup = z.infer<typeof postmanGroupSchema>
export type PostmanCollectionFile = z.infer<typeof postmanCollectionSchema>
export type PostmanEnvironmentFile = z.infer<typeof postmanEnvironmentSchema>
export type PostmanKeyValue = z.infer<typeof keyValue>
export type PostmanVariable = z.infer<typeof variable>
export type PostmanAuth = z.infer<typeof auth>
export type PostmanEvent = z.infer<typeof event>
export type PostmanBody = z.infer<typeof body>
export type PostmanUrlObject = z.infer<typeof urlObject>
export type PostmanRequest = z.infer<typeof request>
export { authParams as postmanAuthParamsSchema }

export function detectPostmanFileKind(json: unknown): 'collection' | 'environment' | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return null
  }
  if ('info' in json && 'item' in json) {
    return 'collection'
  }
  if ('values' in json && Array.isArray(json.values) && !('info' in json)) {
    return 'environment'
  }
  return null
}

/** `item[3].request.url: expected string or object` — the shape import errors are shown in. */
export function describeSchemaIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.reduce<string>((text, segment) => {
    if (typeof segment === 'number') {
      return `${text}[${segment}]`
    }
    return text ? `${text}.${String(segment)}` : String(segment)
  }, '')
  return path ? `${path}: ${issue.message}` : issue.message
}
