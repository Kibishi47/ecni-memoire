import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgres://user:password@localhost:5432/pokemon_tcg_db',
      RATE_LIMIT_MAX_REPORTS_PER_HOUR: '5',
    },
  },
})
