// Text primitives for report.md: escaping, fences, durations.

export function escapeTableCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function inlineCode(text: string): string {
  if (!text.includes('`')) {
    return `\`${text}\``
  }
  return `\`\` ${text} \`\``
}

export function fencedBlock(language: string, content: string): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language}\n${content}\n${fence}`
}

export function isJsonText(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min ${String(seconds).padStart(2, '0')} s`
  }
  if (minutes > 0) {
    return `${minutes} min ${String(seconds).padStart(2, '0')} s`
  }
  return `${seconds} s`
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** `utcOffsetMinutes` is minutes east of UTC; passing it keeps output independent of the host zone. */
export function formatLocalTimestamp(epochMs: number, utcOffsetMinutes: number): string {
  const shifted = new Date(epochMs + utcOffsetMinutes * 60_000)
  const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
  const time = `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`
  const sign = utcOffsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(utcOffsetMinutes)
  return `${date} ${time} (UTC${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)})`
}

/** Screenshot paths are stored relative to the evidence folder; links always use `/`. */
export function toRelativeImageLink(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  return normalized.startsWith('images/') ? normalized : `images/${normalized}`
}
