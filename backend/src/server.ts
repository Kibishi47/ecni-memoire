import path from 'node:path'
import { pathToFileURL } from 'node:url'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { env } from './config/env.js'
import { closePool, getPool } from './db/pool.js'
import { registerCardRoutes } from './routes/cards.js'
import { registerDeckRoutes } from './routes/decks.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerReportRoutes } from './routes/reports.js'
import type { GitHubIssueCreator } from './services/githubService.js'
import type { InMemoryRateLimiter } from './services/rateLimiter.js'

export interface BuildServerOptions {
  pool?: Pool
  logger?: boolean
  githubService?: GitHubIssueCreator
  reportRateLimiter?: InMemoryRateLimiter
}

/**
 * Builds and configures the Fastify application instance.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const pool = options.pool ?? getPool()

  const app = Fastify({
    logger: options.logger ?? env.NODE_ENV !== 'test',
    trustProxy: true,
  })

  await app.register(cors, {
    origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((o) => o.trim()) : true,
  })

  await registerHealthRoutes(app, { pool })
  await registerDeckRoutes(app, { pool })
  await registerCardRoutes(app, { pool })
  await registerReportRoutes(app, {
    pool,
    githubService: options.githubService,
    rateLimiter: options.reportRateLimiter,
  })

  app.addHook('onClose', async () => {
    if (!options.pool) {
      await closePool()
    }
  })

  return app
}

async function start(): Promise<void> {
  const app = await buildServer()

  const shutdown = async (signal: string) => {
    app.log.info(`Réception du signal ${signal}, arrêt propre du serveur...`)
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'Erreur lors de la fermeture du serveur')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (err) {
    app.log.error({ err }, 'Impossible de démarrer le serveur Fastify')
    process.exit(1)
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href

if (isDirectExecution) {
  void start()
}
