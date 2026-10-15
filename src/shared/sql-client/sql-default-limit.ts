import { maskSqlText } from './sql-text-masking'
import type { SqlStatement } from './sql-statement-splitter'

export const DEFAULT_ROW_CAP = 1000

const SELECT_HEAD = /^(?:select|with)\b/i
const OUTER_VERB = /\b(select|insert|update|delete|merge)\b/i
const HAS_LIMIT = /\blimit\b|\bfetch\s+(?:first|next)\b/i
const HAS_INTO = /\binto\b/i

function isCappable(text: string): boolean {
  const skeleton = maskSqlText(text, { topLevelOnly: true }).trim()
  if (!SELECT_HEAD.test(skeleton) || HAS_LIMIT.test(skeleton) || HAS_INTO.test(skeleton)) {
    return false
  }
  // A WITH ending in INSERT/UPDATE/DELETE would be broken by an appended LIMIT.
  return OUTER_VERB.exec(skeleton)?.[1].toLowerCase() === 'select'
}

/**
 * Caps a lone SELECT/WITH statement that has no limit of its own. Multi-statement runs are left
 * alone: one cap cannot speak for several results.
 */
export function applyDefaultLimit(
  statements: readonly SqlStatement[],
  limit: number = DEFAULT_ROW_CAP
): { statements: SqlStatement[]; rowCapApplied: boolean } {
  const [only] = statements
  if (statements.length !== 1 || !isCappable(only.text)) {
    return { statements: [...statements], rowCapApplied: false }
  }
  // A newline keeps a trailing line comment from swallowing the appended LIMIT.
  return {
    statements: [{ ...only, text: `${only.text}\nLIMIT ${limit}` }],
    rowCapApplied: true
  }
}
