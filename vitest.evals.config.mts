import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Evals contra el modelo real: `pnpm evals` (necesita ANTHROPIC_API_KEY; consume tokens).
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['evals/**/*.eval.ts'], testTimeout: 30 * 60_000, fileParallelism: false }
})
