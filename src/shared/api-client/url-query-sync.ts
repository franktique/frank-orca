import type { KeyValue, RequestUrl } from './api-client-types'
import { parseQueryFromRaw } from './postman-field-mapping'

/** `raw` is the source of truth; the query list adds disabled rows that raw cannot hold. */

function splitRaw(raw: string): { base: string; hash: string } {
  const hashIndex = raw.indexOf('#')
  const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : raw.slice(hashIndex)
  const queryIndex = withoutHash.indexOf('?')
  return { base: queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex), hash }
}

/** The user edited the params table: rebuild `raw` from the enabled rows. */
export function applyQueryRows(url: RequestUrl, rows: KeyValue[]): RequestUrl {
  const { base, hash } = splitRaw(url.raw)
  const pairs = rows
    .filter((row) => row.enabled && (row.key !== '' || row.value !== ''))
    .map((row) => `${row.key}=${row.value}`)
  return { raw: `${base}${pairs.length ? `?${pairs.join('&')}` : ''}${hash}`, query: rows }
}

/** The user edited the URL text: refresh the enabled rows, keeping disabled rows where they were. */
export function applyRawUrl(url: RequestUrl, raw: string): RequestUrl {
  const parsed = parseQueryFromRaw(raw)
  let nextParsed = 0
  const merged: KeyValue[] = []
  for (const row of url.query) {
    if (!row.enabled) {
      merged.push(row)
    } else if (nextParsed < parsed.length) {
      merged.push({ ...row, ...parsed[nextParsed++] })
    }
  }
  merged.push(...parsed.slice(nextParsed))
  return { raw, query: merged }
}
