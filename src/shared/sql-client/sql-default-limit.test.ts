import { describe, expect, it } from 'vitest'
import { applyDefaultLimit } from './sql-default-limit'
import { splitSqlStatements } from './sql-statement-splitter'

const run = (sql: string, cap?: number) => applyDefaultLimit(splitSqlStatements(sql), cap)
const first = (sql: string): string | undefined => run(sql).statements[0]?.text

describe('applyDefaultLimit', () => {
  it('appends LIMIT to a bare SELECT', () => {
    const result = run('select 1')
    expect(result.statements[0].text).toBe('select 1\nLIMIT 1000')
    expect(result.rowCapApplied).toBe(true)
  })

  it('honours a custom cap', () => {
    expect(first('select 1')).toBe('select 1\nLIMIT 1000')
    expect(run('select 1', 50).statements[0].text).toBe('select 1\nLIMIT 50')
  })

  it('leaves LIMIT n, LIMIT ALL and FETCH FIRST alone', () => {
    for (const sql of [
      'SELECT 1 LIMIT 5',
      'select 1 limit all',
      'select * from t order by a fetch first 3 rows only',
      'select * from t FETCH NEXT 3 ROWS ONLY'
    ]) {
      const result = run(sql)
      expect(result.rowCapApplied).toBe(false)
      expect(result.statements[0].text).toBe(sql)
    }
  })

  it('handles a trailing semicolon without moving it', () => {
    // The splitter already drops the semicolon, so the cap lands before it would be re-added.
    expect(first('select 1;')).toBe('select 1\nLIMIT 1000')
  })

  it('appends after leading comments and keeps a trailing line comment from eating the LIMIT', () => {
    expect(run('-- note\nselect 1').rowCapApplied).toBe(true)
    expect(run('/* hi */ SELECT 1').rowCapApplied).toBe(true)
    expect(first('select 1 -- trailing')).toBe('select 1 -- trailing\nLIMIT 1000')
  })

  it('caps a CTE whose outer statement is a SELECT', () => {
    expect(run('with c as (select 1) select * from c').rowCapApplied).toBe(true)
  })

  it('does not cap a WITH whose outer statement writes', () => {
    for (const sql of [
      'with c as (select 1) delete from t where id in (select * from c)',
      'with c as (select 1) update t set a = 1',
      'with c as (select 1) insert into t select * from c',
      'with d as (delete from t returning *) select * from d limit 3'
    ]) {
      const result = run(sql)
      expect(result.rowCapApplied).toBe(false)
      expect(result.statements[0].text).toBe(sql)
    }
  })

  it('does not cap statements that are not SELECT or WITH', () => {
    for (const sql of [
      'insert into t values (1)',
      'update t set x=1',
      'explain select 1',
      'values (1)',
      '   '
    ]) {
      expect(run(sql).rowCapApplied).toBe(false)
    }
  })

  it('does not cap multi-statement runs', () => {
    const result = run('select 1; select 2')
    expect(result.rowCapApplied).toBe(false)
    expect(result.statements.map((s) => s.text)).toEqual(['select 1', 'select 2'])
  })

  it('is not fooled by LIMIT inside strings, comments or subqueries', () => {
    expect(run(`select 'limit 5'`).rowCapApplied).toBe(true)
    expect(run('select 1 -- limit 5').rowCapApplied).toBe(true)
    expect(run('select * from (select * from t limit 5) x').rowCapApplied).toBe(true)
  })

  it('does not cap SELECT INTO, which creates a table', () => {
    expect(run('select * into copy from t').rowCapApplied).toBe(false)
  })
})
