const DOLLAR_OPEN = /^\$(?:[A-Za-z_]\w*)?\$/

/**
 * Blanks comments, quoted text and dollar-quoted bodies with spaces (same length), so keyword
 * checks only see real code. With `topLevelOnly`, parenthesized bodies are blanked too.
 */
export function maskSqlText(sql: string, options: { topLevelOnly?: boolean } = {}): string {
  let out = ''
  let depth = 0
  let i = 0
  const blank = (to: number): void => {
    out += ' '.repeat(to - i)
    i = to
  }
  while (i < sql.length) {
    const char = sql[i]
    const next = sql[i + 1]
    const dollarTag = char === '$' ? DOLLAR_OPEN.exec(sql.slice(i, i + 130))?.[0] : undefined
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i)
      blank(newline === -1 ? sql.length : newline)
    } else if (char === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2)
      blank(close === -1 ? sql.length : close + 2)
    } else if (char === "'" || char === '"') {
      let to = i + 1
      while (to < sql.length && !(sql[to] === char && sql[to + 1] !== char)) {
        to += sql[to] === char ? 2 : 1
      }
      blank(Math.min(to + 1, sql.length))
    } else if (dollarTag) {
      const close = sql.indexOf(dollarTag, i + dollarTag.length)
      blank(close === -1 ? sql.length : close + dollarTag.length)
    } else if (options.topLevelOnly && char === '(') {
      depth++
      out += ' '
      i++
    } else if (options.topLevelOnly && char === ')') {
      depth = Math.max(0, depth - 1)
      out += ' '
      i++
    } else {
      out += options.topLevelOnly && depth > 0 ? ' ' : char
      i++
    }
  }
  return out
}
