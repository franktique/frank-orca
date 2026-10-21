export const MAX_BODY_BYTES = 100 * 1024
export const MAX_RESULT_ROWS = 200

export type TruncatedBody = { text: string; note: string | null }
export type TruncatedRows<T> = { rows: T[]; note: string | null }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const trim = (value: number): string => String(Number(value.toFixed(1)))
  return bytes < 1024 * 1024 ? `${trim(bytes / 1024)} KB` : `${trim(bytes / (1024 * 1024))} MB`
}

export function truncateBody(text: string, maxBytes = MAX_BODY_BYTES): TruncatedBody {
  const bytes = encoder.encode(text)
  if (bytes.length <= maxBytes) {
    return { text, note: null }
  }
  let cut = maxBytes
  // Why: UTF-8 continuation bytes are 10xxxxxx; backing up avoids splitting a code point.
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
    cut -= 1
  }
  return {
    text: decoder.decode(bytes.subarray(0, cut)),
    note: `> Truncated: showing ${formatByteSize(maxBytes)} of ${formatByteSize(bytes.length)}.`
  }
}

/** `totalRows` may exceed `rows.length` when the source was already capped. */
export function truncateRows<T>(
  rows: readonly T[],
  totalRows: number = rows.length,
  maxRows = MAX_RESULT_ROWS
): TruncatedRows<T> {
  const total = Math.max(totalRows, rows.length)
  if (total <= maxRows) {
    return { rows: [...rows], note: null }
  }
  return {
    rows: rows.slice(0, maxRows),
    note: `> Truncated: showing ${maxRows.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows.`
  }
}
