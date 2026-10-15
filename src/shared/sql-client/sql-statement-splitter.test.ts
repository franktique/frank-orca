import { describe, expect, it } from 'vitest'
import { splitSqlStatements } from './sql-statement-splitter'

const texts = (sql: string): string[] => splitSqlStatements(sql).map((s) => s.text)

describe('splitSqlStatements', () => {
  it('splits on semicolons and keeps a trailing statement without one', () => {
    expect(texts('select 1; select 2;\nselect 3')).toEqual(['select 1', 'select 2', 'select 3'])
  })

  it('ignores semicolons inside single quotes, including doubled quotes', () => {
    expect(texts(`select 'a;b', 'it''s; ok'; select 2`)).toEqual([
      `select 'a;b', 'it''s; ok'`,
      'select 2'
    ])
  })

  it('honours backslash escapes only in E strings', () => {
    expect(texts(`select E'it\\'s; ok'; select 2`)).toEqual([`select E'it\\'s; ok'`, 'select 2'])
    // A plain string ends at the quote after the backslash.
    expect(texts(`select 'a\\'; select 2`)).toEqual([`select 'a\\'`, 'select 2'])
  })

  it('ignores semicolons inside double-quoted identifiers', () => {
    expect(texts(`select 1 as "a;b"; select 2`)).toEqual([`select 1 as "a;b"`, 'select 2'])
  })

  it('ignores semicolons inside $$ and $tag$ dollar quotes', () => {
    const fn = `create function f() returns int as $$ begin select 1; return 1; end $$ language plpgsql`
    const tagged = `do $body$ begin perform 1; end $body$`
    expect(texts(`${fn}; ${tagged}; select 3`)).toEqual([fn, tagged, 'select 3'])
  })

  it('does not treat $1 parameters or identifier dollars as quotes', () => {
    expect(texts('select $1; select a$$b')).toEqual(['select $1', 'select a$$b'])
  })

  it('ignores semicolons inside line comments', () => {
    expect(texts('select 1 -- not; a split\n; select 2')).toEqual([
      'select 1 -- not; a split',
      'select 2'
    ])
  })

  it('ignores semicolons inside nested block comments', () => {
    expect(texts('select /* a; /* b; */ c; */ 1; select 2')).toEqual([
      'select /* a; /* b; */ c; */ 1',
      'select 2'
    ])
  })

  it('drops empty and comment-only statements', () => {
    expect(texts(';; select 1;;  ;\n-- just a note\n; /* block */ ;')).toEqual(['select 1'])
    expect(splitSqlStatements('   ')).toEqual([])
  })

  it('reports the offset of each statement start in the original text', () => {
    const sql = 'select 1;\n  select 2;   select 3'
    const result = splitSqlStatements(sql)
    expect(result.map((s) => sql.slice(s.startOffset, s.startOffset + s.text.length))).toEqual(
      result.map((s) => s.text)
    )
    expect(result.map((s) => s.startOffset)).toEqual([0, 12, 24])
  })

  it('keeps an unterminated quote as one statement', () => {
    expect(texts(`select 'oops; select 2`)).toEqual([`select 'oops; select 2`])
  })
})
