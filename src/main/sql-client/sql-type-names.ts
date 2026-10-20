import type { Client } from 'pg'

/** Per-connection cache of `oid → format_type(oid, NULL)` so each type is looked up once. */
export class SqlTypeNameCache {
  private readonly names = new Map<number, string>()

  async resolve(client: Client, oids: readonly number[]): Promise<Map<number, string>> {
    const unknown = [...new Set(oids)].filter((oid) => !this.names.has(oid))
    if (unknown.length > 0) {
      try {
        const result = await client.query<{ oid: string; name: string }>({
          text: 'SELECT oid::text AS oid, format_type(oid, NULL) AS name FROM pg_type WHERE oid = ANY($1::oid[])',
          values: [unknown]
        })
        for (const row of result.rows) {
          this.names.set(Number(row.oid), row.name)
        }
      } catch {
        // Type names are decoration; a failed lookup must not fail the run.
      }
    }
    return new Map(oids.map((oid) => [oid, this.names.get(oid) ?? String(oid)]))
  }
}
