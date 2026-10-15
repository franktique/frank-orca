import type { SecretStore } from '../../shared/secret-store'
import type { SqlConnectionUpdateInput } from '../../shared/sql-client/sql-client-ipc-schemas'
import { getSqlAgentAccess } from '../../shared/sql-client/sql-connection-locality'
import type {
  SqlConnection,
  SqlConnectionStatus,
  SqlConnectionView,
  SqlPasswordState
} from '../../shared/sql-client/sql-client-types'
import { openSecretCipher, sealSecretValue } from '../secret-value-codec'

export function derivePasswordState(
  connection: SqlConnection,
  sessionPasswords: ReadonlyMap<string, string>,
  secretStore: SecretStore
): SqlPasswordState {
  if (connection.password === null) {
    return sessionPasswords.has(connection.id) ? 'session-only' : 'empty'
  }
  return openSecretCipher(connection.password.cipher, secretStore) === null
    ? 'needs-reentry'
    : 'set'
}

/** Built field by field so a password or cipher can never ride along into a view. */
export function toConnectionView(
  connection: SqlConnection,
  passwordState: SqlPasswordState,
  status: SqlConnectionStatus
): SqlConnectionView {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.database,
    sslMode: connection.sslMode,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    revision: connection.revision,
    passwordState,
    agentAccess: getSqlAgentAccess(connection.host),
    status
  }
}

/** Stores the password sealed, or session-only when the host cannot encrypt. */
export function storePassword(
  sessionPasswords: Map<string, string>,
  connectionId: string,
  password: string,
  secretStore: SecretStore
): SqlConnection['password'] {
  sessionPasswords.delete(connectionId)
  if (password === '') {
    return null
  }
  const cipher = sealSecretValue(password, secretStore)
  if (cipher === '') {
    sessionPasswords.set(connectionId, password)
    return null
  }
  return { cipher }
}

type ConnectionFieldUpdates = Partial<
  Pick<SqlConnection, 'name' | 'host' | 'port' | 'user' | 'database' | 'sslMode'>
>

/** Drops fields the caller left out, so a partial update never overwrites with `undefined`. */
export function definedFields(
  fields: Omit<SqlConnectionUpdateInput, 'password'>
): ConnectionFieldUpdates {
  const updates: ConnectionFieldUpdates = {}
  if (fields.name !== undefined) {
    updates.name = fields.name
  }
  if (fields.host !== undefined) {
    updates.host = fields.host
  }
  if (fields.port !== undefined) {
    updates.port = fields.port
  }
  if (fields.user !== undefined) {
    updates.user = fields.user
  }
  if (fields.database !== undefined) {
    updates.database = fields.database
  }
  if (fields.sslMode !== undefined) {
    updates.sslMode = fields.sslMode
  }
  return updates
}
