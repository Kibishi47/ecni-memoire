import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { checkDatabaseHealth } from '../db/pool.js'

export interface HealthRouteOptions {
  pool?: Pool
}

/**
 * Registers `GET /health` endpoint verifying PostgreSQL connectivity.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions = {},
): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const timestamp = new Date().toISOString()
    try {
      await checkDatabaseHealth(options.pool)
      return reply.status(200).send({
        status: 'ok',
        timestamp,
      })
    } catch (error) {
      app.log.error({ err: error }, '[health] Échec de connexion à PostgreSQL')
      return reply.status(503).send({
        status: 'error',
        timestamp,
        error: 'Database connectivity check failed',
      })
    }
  })
}
