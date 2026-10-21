import type { ResponseSnapshot } from '../api-client/api-client-types'

export type CaptureResult = { ok: true; value: string } | { ok: false; error: string }

const HEADER_PREFIX = 'header:'

function readPath(root: unknown, from: string): unknown {
  let current: unknown = root
  for (const token of from.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (token[2] !== undefined) {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[Number(token[2])]
    } else {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        return undefined
      }
      current = Object.entries(current).find(([name]) => name === token[1])?.[1]
    }
  }
  return current
}

function stringifyCaptured(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** `from` is `header:<name>` or a JSON path such as `id` or `data.items[0].id`. */
export function captureFromResponse(
  variable: string,
  from: string,
  response: Pick<ResponseSnapshot, 'headers' | 'body'>
): CaptureResult {
  const failure: CaptureResult = {
    ok: false,
    error: `could not capture ${variable} from response`
  }
  let captured: string | null = null

  if (from.toLowerCase().startsWith(HEADER_PREFIX)) {
    const name = from.slice(HEADER_PREFIX.length).trim().toLowerCase()
    captured = response.headers.find(([header]) => header.toLowerCase() === name)?.[1] ?? null
  } else if (response.body.encoding === 'utf8' && response.body.text) {
    try {
      captured = stringifyCaptured(readPath(JSON.parse(response.body.text), from))
    } catch {
      return failure
    }
  }
  return captured === null ? failure : { ok: true, value: captured }
}
