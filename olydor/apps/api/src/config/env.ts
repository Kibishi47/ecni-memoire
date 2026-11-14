import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Resolves the root directory of the `backend/` package regardless of whether
 * code is executed from `src/` (via tsx) or `dist/` (via node).
 */
export function getBackendRoot(): string {
  return path.resolve(__dirname, '../..')
}

function loadDotenvFile(): void {
  const candidates = [
    path.resolve(getBackendRoot(), '.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath })
      return
    }
  }
  dotenv.config()
}

loadDotenvFile()

const optionalNonEmptyString = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().trim().min(1).optional(),
)

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL est obligatoire')
    .refine(
      (url) => url.startsWith('postgres://') || url.startsWith('postgresql://'),
      'DATABASE_URL doit être une URL PostgreSQL valide (postgres:// ou postgresql://)',
    ),
  GITHUB_TOKEN: optionalNonEmptyString,
  GITHUB_REPO_OWNER: optionalNonEmptyString,
  GITHUB_REPO_NAME: optionalNonEmptyString,
  RATE_LIMIT_MAX_REPORTS_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(5),
  CORS_ORIGIN: optionalNonEmptyString,
})

export type AppEnv = z.infer<typeof envSchema>

/**
 * Parses and validates environment variables with Zod.
 */
export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): AppEnv {
  const result = envSchema.safeParse(rawEnv)
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'ENV'}: ${issue.message}`)
      .join('\n')
    throw new Error(`[config] Configuration d'environnement invalide :\n${formatted}`)
  }
  return result.data
}

export const env: AppEnv = parseEnv()
