import { describe, expect, it } from 'vitest'
import {
  containsTransactionControl,
  isReadOnlyBypassStatement,
  isTransactionControlStatement
} from './sql-transaction-control'
import { splitSqlStatements } from './sql-statement-splitter'

describe('isTransactionControlStatement', () => {
  it.each([
    'BEGIN',
    'begin work',
    'START TRANSACTION',
    'start  transaction isolation level serializable',
    'COMMIT',
    'commit and chain',
    'END',
    'end transaction',
    'ROLLBACK',
    'rollback to savepoint a',
    'SAVEPOINT a',
    'RELEASE SAVEPOINT a',
    'release a',
    "PREPARE TRANSACTION 'x'",
    "COMMIT PREPARED 'x'",
    'ABORT',
    '-- note\nCOMMIT',
    '/* c */ begin'
  ])('detects %s', (sql) => {
    expect(isTransactionControlStatement(sql)).toBe(true)
  })

  it.each([
    "select 'commit'",
    'select begin_date from t',
    'select "end" from t',
    'insert into commits values (1)',
    'do $$ begin perform 1; end $$',
    'prepare p as select 1',
    'update t set a = 1',
    ''
  ])('does not flag %s', (sql) => {
    expect(isTransactionControlStatement(sql)).toBe(false)
  })

  it('looks across a whole run', () => {
    expect(containsTransactionControl(splitSqlStatements('select 1; commit; select 2'))).toBe(true)
    expect(containsTransactionControl(splitSqlStatements('select 1; select 2'))).toBe(false)
  })
})

describe('isReadOnlyBypassStatement', () => {
  it.each([
    'SET transaction_read_only = off',
    'set local transaction_read_only to off',
    'SET default_transaction_read_only = false',
    'RESET transaction_read_only',
    'RESET ALL',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
    'SET TRANSACTION READ WRITE',
    "select set_config('transaction_read_only', 'off', false)",
    'ALTER ROLE app SET default_transaction_read_only = off',
    'DO $$ begin perform 1; end $$'
  ])('flags %s', (sql) => {
    expect(isReadOnlyBypassStatement(sql)).toBe(true)
  })

  it.each([
    'SHOW transaction_read_only',
    'select 1',
    "select 'set transaction_read_only = off'",
    'set search_path to public',
    'set statement_timeout = 5000'
  ])('allows %s', (sql) => {
    expect(isReadOnlyBypassStatement(sql)).toBe(false)
  })
})
