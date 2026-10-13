import type { Environment, KeyValue, Variable } from './api-client-types'
import { isRecord } from './postman-field-mapping'

type Loose = Record<string, unknown>

function record(value: unknown): Loose {
  return isRecord(value) ? value : {}
}

// ─── Key/value rows and variables ───────────────────────────────────

export function exportKeyValues(rows: readonly KeyValue[]): Loose[] {
  return rows.map((row) => {
    const { descriptionObject, ...extra } = record(row.postmanExtra)
    return {
      ...extra,
      key: row.key,
      value: row.value,
      ...(row.enabled ? {} : { disabled: true }),
      ...(row.type !== undefined ? { type: row.type } : {}),
      ...(descriptionObject !== undefined
        ? { description: descriptionObject }
        : row.description !== undefined
          ? { description: row.description }
          : {})
    }
  })
}

export function exportVariables(rows: readonly Variable[]): Loose[] {
  return rows.map((row) => ({
    ...record(row.postmanExtra),
    key: row.key,
    value: row.value,
    ...(row.enabled ? {} : { disabled: true }),
    ...(row.description !== undefined ? { description: row.description } : {})
  }))
}

/** Secret values are written in plain text, as Postman does; callers warn the user first. */
export function exportPostmanEnvironment(environment: Environment): Loose {
  return {
    _postman_variable_scope: 'environment',
    ...environment.postmanExtra,
    id: environment.id,
    name: environment.name,
    values: environment.variables.map((variable) => ({
      key: variable.key,
      value: variable.value ?? '',
      type: variable.type,
      enabled: variable.enabled
    }))
  }
}
