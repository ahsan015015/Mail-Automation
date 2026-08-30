import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src/client'),
      '@shared': r('./src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The suite boots real servers on ephemeral ports; keep it sequential so
    // 2-core machines do not time out.
    fileParallelism: false,
    pool: 'forks',
  },
})
