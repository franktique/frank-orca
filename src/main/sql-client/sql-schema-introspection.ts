import type { Client } from 'pg'
import type {
  SqlColumnInfo,
  SqlRelation,
  SqlRelationKind,
  SqlSchema
} from '../../shared/sql-client/sql-client-types'

const RELATION_KINDS: Record<string, SqlRelationKind> = {
  r: 'table',
  v: 'view',
  m: 'materialized-view',
  p: 'partitioned-table',
  f: 'foreign-table'
}

/** Remembers each level of the tree so expanding twice costs one query; `clear` is Refresh. */
export class SqlSchemaCache {
  schemas: SqlSchema[] | null = null
  readonly relations = new Map<string, SqlRelation[]>()
  readonly columns = new Map<string, SqlColumnInfo[]>()

  clear(): void {
    this.schemas = null
    this.relations.clear()
    this.columns.clear()
  }
}

export async function listSchemas(client: Client): Promise<SqlSchema[]> {
  const result = await client.query<{ name: string }>(
    `SELECT nspname AS name
       FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND nspname !~ '^pg_temp_'
        AND nspname !~ '^pg_toast_temp_'
      ORDER BY nspname`
  )
  return result.rows.map((row) => ({ name: row.name }))
}

export async function listRelations(client: Client, schema: string): Promise<SqlRelation[]> {
  const result = await client.query<{ name: string; kind: string }>({
    text: `SELECT c.relname AS name, c.relkind::text AS kind
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
            ORDER BY c.relname`,
    values: [schema]
  })
  return result.rows.flatMap((row) => {
    const kind = RELATION_KINDS[row.kind]
    return kind ? [{ schema, name: row.name, kind }] : []
  })
}

export async function listColumns(
  client: Client,
  schema: string,
  relation: string
): Promise<SqlColumnInfo[]> {
  const result = await client.query<{
    name: string
    type: string
    not_null: string
    is_primary_key: string
    ordinal: string
  }>({
    text: `SELECT a.attname AS name,
                  format_type(a.atttypid, a.atttypmod) AS type,
                  a.attnotnull::text AS not_null,
                  a.attnum::text AS ordinal,
                  EXISTS (
                    SELECT 1 FROM pg_index i
                     WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)
                  )::text AS is_primary_key
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum`,
    values: [schema, relation]
  })
  // Every value arrives as text on these connections, booleans as 'true' / 'false'.
  return result.rows.map((row) => ({
    name: row.name,
    dataTypeName: row.type,
    nullable: row.not_null !== 'true',
    isPrimaryKey: row.is_primary_key === 'true',
    ordinal: Number(row.ordinal)
  }))
}

export async function cachedListSchemas(
  client: Client,
  cache: SqlSchemaCache
): Promise<SqlSchema[]> {
  cache.schemas ??= await listSchemas(client)
  return cache.schemas
}

export async function cachedListRelations(
  client: Client,
  cache: SqlSchemaCache,
  schema: string
): Promise<SqlRelation[]> {
  const known = cache.relations.get(schema)
  if (known) {
    return known
  }
  const loaded = await listRelations(client, schema)
  cache.relations.set(schema, loaded)
  return loaded
}

export async function cachedListColumns(
  client: Client,
  cache: SqlSchemaCache,
  schema: string,
  relation: string
): Promise<SqlColumnInfo[]> {
  const key = JSON.stringify([schema, relation])
  const known = cache.columns.get(key)
  if (known) {
    return known
  }
  const loaded = await listColumns(client, schema, relation)
  cache.columns.set(key, loaded)
  return loaded
}
