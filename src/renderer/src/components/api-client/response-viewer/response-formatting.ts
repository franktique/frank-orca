export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

/** JSON up to this size is pretty-printed by default; larger bodies open in Raw (FR-014). */
export const PRETTY_PRINT_MAX_CHARS = 2 * 1024 * 1024

export function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && /json/i.test(contentType)
}

/** Returns formatted JSON, or null when the text does not parse. */
export function prettyPrintJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}
