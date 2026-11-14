import path from 'node:path'
import { pathToFileURL } from 'node:url'
import compress from '@fastify/compress'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { env } from './config/env.js'
import { closePool, getPool } from './db/pool.js'
import { registerCardRoutes } from './routes/cards.js'
import { registerDeckRoutes } from './routes/decks.js'
import { ensureEngineCatalogLoaded, registerEngineRoutes } from './routes/engine.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerReportRoutes } from './routes/reports.js'
import type { AlternativesService, CardCatalogCache } from './services/alternativesService.js'
import type { GitHubIssueCreator } from './services/githubService.js'
import type { InMemoryRateLimiter } from './services/rateLimiter.js'

export const DEFAULT_ALLOWED_ORIGINS = [
  'https://meta-oracle.com',
  'https://www.meta-oracle.com',
  'https://sim.meta-oracle.com',
  'https://arena.meta-oracle.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
] as const

export interface BuildServerOptions {
  pool?: Pool
  logger?: boolean
  githubService?: GitHubIssueCreator
  reportRateLimiter?: InMemoryRateLimiter
  catalogCache?: CardCatalogCache
  alternativesService?: AlternativesService
  corsOrigins?: string[] | '*'
}

function buildCorsOriginHandler(customOrigins?: string[] | '*') {
  if (customOrigins === '*' || env.CORS_ORIGIN?.trim() === '*') {
    return true
  }

  const allowedSet = new Set<string>(DEFAULT_ALLOWED_ORIGINS)
  if (env.CORS_ORIGIN) {
    for (const item of env.CORS_ORIGIN.split(',')) {
      const cleaned = item.trim().replace(/\/+$/, '')
      if (cleaned) allowedSet.add(cleaned)
    }
  }
  if (Array.isArray(customOrigins)) {
    for (const item of customOrigins) {
      const cleaned = item.trim().replace(/\/+$/, '')
      if (cleaned) allowedSet.add(cleaned)
    }
  }

  return (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
    if (!origin) {
      callback(null, true)
      return
    }
    const normalized = origin.trim().replace(/\/+$/, '')
    callback(null, allowedSet.has(normalized))
  }
}

/**
 * Builds and configures the Fastify application instance (`api.meta-oracle.com`).
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const pool = options.pool ?? getPool()
  ensureEngineCatalogLoaded()

  const app = Fastify({
    logger: options.logger ?? env.NODE_ENV !== 'test',
    trustProxy: true,
  })

  await app.register(compress, {
    global: true,
    threshold: 1024,
  })

  await app.register(cors, {
    origin: buildCorsOriginHandler(options.corsOrigins),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  })

  await registerHealthRoutes(app, { pool })
  await registerDeckRoutes(app, { pool })
  await registerEngineRoutes(app)
  await registerCardRoutes(app, {
    pool,
    catalogCache: options.catalogCache,
    alternativesService: options.alternativesService,
  })
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
