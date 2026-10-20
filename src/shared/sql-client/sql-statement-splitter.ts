export type SqlStatement = { text: string; startOffset: number }

const isIdentifierChar = (char: string | undefined): boolean =>
  char !== undefined && /[A-Za-z0-9_$]/.test(char)

/** End index (exclusive) of a quoted run starting at `start`, which holds the opening quote. */
function skipQuoted(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
  let i = start + 1
  while (i < sql.length) {
    const char = sql[i]
    if (backslashEscapes && char === '\\') {
      i += 2
      continue
    }
    if (char === quote) {
      if (sql[i + 1] === quote) {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return sql.length
}

function skipBlockComment(sql: string, start: number): number {
  let depth = 1
  let i = start + 2
  while (i < sql.length && depth > 0) {
    if (sql[i] === '/' && sql[i + 1] === '*') {
      depth++
      i += 2
    } else if (sql[i] === '*' && sql[i + 1] === '/') {
      depth--
      i += 2
    } else {
      i++
    }
  }
  return i
}

/** Returns the end of a dollar-quoted body when `start` opens one, else null. */
function skipDollarQuoted(sql: string, start: number): number | null {
  if (isIdentifierChar(sql[start - 1])) {
    return null
  }
  const open = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start, start + 130))
  if (!open) {
    return null
  }
  const close = sql.indexOf(open[0], start + open[0].length)
  return close === -1 ? sql.length : close + open[0].length
}

/**
 * Splits on top-level semicolons, skipping quotes, dollar quotes and comments. A statement keeps
 * any leading comment so error positions map back with one addition. Empty and comment-only
 * statements are dropped.
 */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = []
  let start = -1
  let end = 0
  let hasCode = false

  const flush = (): void => {
    if (hasCode && start >= 0) {
      statements.push({ text: sql.slice(start, end), startOffset: start })
    }
    start = -1
    hasCode = false
  }
  const touch = (from: number, to: number, isCode: boolean): void => {
    if (start < 0) {
      start = from
    }
    end = to
    hasCode ||= isCode
  }

  let i = 0
  while (i < sql.length) {
    const char = sql[i]
    const next = sql[i + 1]
    if (char === ';') {
      flush()
      i++
    } else if (/\s/.test(char)) {
      i++
    } else if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i)
      const to = newline === -1 ? sql.length : newline
      touch(i, to, false)
      i = to
    } else if (char === '/' && next === '*') {
      const to = skipBlockComment(sql, i)
      touch(i, to, false)
      i = to
    } else if (char === "'") {
      const escapes = (sql[i - 1] === 'E' || sql[i - 1] === 'e') && !isIdentifierChar(sql[i - 2])
      const to = skipQuoted(sql, i, "'", escapes)
      touch(i, to, true)
      i = to
    } else if (char === '"') {
      const to = skipQuoted(sql, i, '"', false)
      touch(i, to, true)
      i = to
    } else {
      const dollarEnd = char === '$' ? skipDollarQuoted(sql, i) : null
      const to = dollarEnd ?? i + 1
      touch(i, to, true)
      i = to
    }
  }
  flush()
  return statements
}
