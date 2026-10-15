import { maskSqlText } from './sql-text-masking'
import type { SqlStatement } from './sql-statement-splitter'

const TRANSACTION_CONTROL_HEAD =
  /^(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/
const READ_ONLY_SETTING = /\b(?:default_)?transaction_read_only\b/
const SESSION_CHARACTERISTICS = /^set\s+session\s+characteristics\b/
const SET_TRANSACTION_MODE = /^set\s+(?:session\s+|local\s+)?transaction\b/
const ALTER_SETTING = /^alter\s+(?:role|user|database)\b[\s\S]*\bset\b/
const SET_CONFIG_CALL = /\bset_config\b/

function head(text: string): string {
  return maskSqlText(text).trim().toLowerCase().replace(/\s+/g, ' ')
}

/** BEGIN / COMMIT / ROLLBACK / SAVEPOINT-family statements, ignoring comments and strings. */
export function isTransactionControlStatement(text: string): boolean {
  return TRANSACTION_CONTROL_HEAD.test(head(text))
}

export function containsTransactionControl(statements: readonly SqlStatement[]): boolean {
  return statements.some((statement) => isTransactionControlStatement(statement.text))
}

/**
 * Statements that could lift a read-only session or transaction. A read-only wrapper alone is not
 * enough: before the first query of a transaction, PostgreSQL still lets `SET` flip it.
 */
export function isReadOnlyBypassStatement(text: string): boolean {
  const code = head(text)
  if (/^(?:set|reset)\b/.test(code)) {
    return (
      READ_ONLY_SETTING.test(code) ||
      /^reset\s+all\b/.test(code) ||
      SESSION_CHARACTERISTICS.test(code) ||
      SET_TRANSACTION_MODE.test(code)
    )
  }
  return (
    SET_CONFIG_CALL.test(code) ||
    (ALTER_SETTING.test(code) && READ_ONLY_SETTING.test(text.toLowerCase())) ||
    // DO runs arbitrary PL code that can issue the SET above.
    /^do\b/.test(code)
  )
}
