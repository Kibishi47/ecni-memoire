import type { FastifyReply } from 'fastify'
import type { ZodType } from 'zod'

/**
 * Validates data with a Zod schema and sends a uniform 400 Bad Request reply on failure.
 */
export function parseWithZod<T>(
  schema: ZodType<T>,
  input: unknown,
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(input)
  if (!result.success) {
    void reply.status(400).send({
      error: 'Validation Error',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return null
  }
  return result.data
}
