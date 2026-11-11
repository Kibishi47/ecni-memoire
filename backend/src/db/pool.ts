import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { env } from '../config/env.js'

let poolInstance: Pool | null = null

/**
 * Creates a configured PostgreSQL connection pool.
 */
export function createPool(connectionString: string = env.DATABASE_URL): Pool {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  pool.on('error', (err) => {
    console.error('[db] Erreur inattendue sur le pool PostgreSQL idle :', err)
  })

  return pool
}

/**
 * Returns the shared PostgreSQL pool singleton.
 */
export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = createPool()
  }
  return poolInstance
}

/**
 * Closes the shared PostgreSQL pool singleton if initialized.
 */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    const toClose = poolInstance
    poolInstance = null
    await toClose.end()
  }
}

/**
 * Executes a parameterized query against the shared pool.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params)
}

/**
 * Executes a callback inside a PostgreSQL transaction with automatic commit/rollback.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Checks PostgreSQL connectivity.
 */
export async function checkDatabaseHealth(pool: Pool = getPool()): Promise<boolean> {
  await pool.query('SELECT 1')
  return true
}
