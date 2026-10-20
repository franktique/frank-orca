// PostgreSQL's reserved keywords plus the non-reserved ones that cannot be function or type names
// (Appendix C): quoting them is always safe, and leaving one bare can be a syntax error.
const KEYWORDS_TO_QUOTE: ReadonlySet<string> = new Set(
  `all analyse analyze and any array as asc asymmetric authorization between bigint binary bit
   boolean both case cast char character check coalesce collate collation column concurrently
   constraint create cross current_catalog current_date current_role current_schema current_time
   current_timestamp current_user dec decimal default deferrable desc distinct do else end except
   exists extract false fetch float for foreign freeze from full grant greatest group grouping
   having ilike in initially inner inout int integer intersect interval into is isnull join
   lateral leading least left like limit localtime localtimestamp merge_action national natural
   nchar none normalize not notnull null nullif numeric offset on only or order out outer
   overlaps overlay placing position precision primary real references returning right row
   select session_user setof similar smallint some substring symmetric system_user table
   tablesample then time timestamp to trailing treat trim true union unique user using values
   varchar variadic verbose when where window with`.split(/\s+/)
)

const BARE_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/

/** Bare only when PostgreSQL would read it back as the same name; otherwise double-quoted. */
export function quotePgIdentifier(name: string): string {
  if (BARE_IDENTIFIER.test(name) && !KEYWORDS_TO_QUOTE.has(name)) {
    return name
  }
  return `"${name.replaceAll('"', '""')}"`
}

/** `schema.relation` (and `.column`), each part quoted only as needed. */
export function quoteQualifiedName(...parts: readonly string[]): string {
  return parts.map(quotePgIdentifier).join('.')
}
